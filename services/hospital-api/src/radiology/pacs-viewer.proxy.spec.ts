import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import request from 'supertest';
import { PACS_VIEWER_PATHS, pacsViewerProxy } from './pacs-viewer.proxy';
import { orthancAuthHeaders } from './orthanc-connection';

const SERVICE_AUTH = `Basic ${Buffer.from('hospital-api:service-secret').toString('base64')}`;
const OWN_STUDY = '1.2.840.1';
const FOREIGN_STUDY = '1.2.840.2';
const qidoStudy = (uid: string) => ({ '0020000D': { vr: 'UI', Value: [uid] }, '00100020': { vr: 'LO', Value: [`MRN-${uid}`] } });

describe('PACS viewer proxy (24.5, 26.4)', () => {
  let orthanc: Server;
  const seen: Array<{ method?: string; url?: string; authorization?: string; cookie?: string }> = [];
  const env = { ...process.env };

  beforeAll(async () => {
    // Fake Orthanc: requires the service credentials and holds one study per hospital.
    orthanc = createServer((req, res) => {
      seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie });
      if (req.headers.authorization !== SERVICE_AUTH) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="Orthanc"' }).end();
        return;
      }
      if (/^\/dicom-web\/(studies|series|instances)(\?|$)/.test(req.url ?? '')) {
        res.writeHead(200, { 'content-type': 'application/dicom+json', 'set-cookie': 'orthanc=1' })
          .end(JSON.stringify([qidoStudy(OWN_STUDY), qidoStudy(FOREIGN_STUDY)]));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/dicom+json' }).end('[{"metadata":true}]');
    });
    await new Promise<void>((resolve) => orthanc.listen(0, '127.0.0.1', resolve));
    process.env.ORTHANC_URL = `http://127.0.0.1:${(orthanc.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    process.env = { ...env };
    await new Promise((resolve) => orthanc.close(resolve));
  });
  beforeEach(() => {
    seen.length = 0;
    process.env.ORTHANC_USERNAME = 'hospital-api';
    process.env.ORTHANC_PASSWORD = 'service-secret';
  });

  // Session hospital "hospital-a" owns OWN_STUDY only.
  const access = {
    isAllowed: async (uid: string, hospitalId: string) => hospitalId === 'hospital-a' && uid === OWN_STUDY,
    allowedUids: async (uids: string[], hospitalId: string) => new Set(uids.filter((uid) => hospitalId === 'hospital-a' && uid === OWN_STUDY)),
  };
  const app = (permissions: string[] | null) => {
    const auth = { getSession: (id?: string) => (id === 'valid-token' && permissions ? { hospitalId: 'hospital-a', permissions } : undefined) };
    const server = express();
    server.use(PACS_VIEWER_PATHS, pacsViewerProxy(auth as never, access as never));
    return server;
  };
  const withSession = 'unitech_ehr_session=valid-token';

  it('refuses requests without an EHR session', async () => {
    await request(app(['radiology'])).get('/dicom-web/studies').expect(401);
    expect(seen).toHaveLength(0);
  });

  it('refuses staff without radiology or clinical permission', async () => {
    await request(app(['billing'])).get('/ohif/viewer').set('Cookie', withSession).expect(403);
    expect(seen).toHaveLength(0);
  });

  it('forwards with the service credentials, not the EHR cookie', async () => {
    const res = await request(app(['radiology'])).get(`/dicom-web/studies/${OWN_STUDY}/metadata`).set('Cookie', withSession).expect(200);
    expect(res.body).toEqual([{ metadata: true }]);
    expect(seen[0]).toMatchObject({ method: 'GET', url: `/dicom-web/studies/${OWN_STUDY}/metadata`, authorization: SERVICE_AUTH });
    expect(seen[0].cookie).toBeUndefined();
  });

  it('removes other hospitals’ studies from searches', async () => {
    for (const level of ['studies', 'series', 'instances']) {
      const res = await request(app(['clinical'])).get(`/dicom-web/${level}?PatientID=*`).set('Cookie', withSession).expect(200);
      expect(res.body.map((item: Record<string, { Value: string[] }>) => item['0020000D'].Value[0])).toEqual([OWN_STUDY]);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('answers 404 for another hospital’s study without contacting the PACS', async () => {
    for (const path of ['metadata', 'series', 'series/9.9/instances/8.8/frames/1']) {
      await request(app(['radiology'])).get(`/dicom-web/studies/${FOREIGN_STUDY}/${path}`).set('Cookie', withSession).expect(404);
    }
    expect(seen.filter((call) => call.url?.includes(FOREIGN_STUDY))).toHaveLength(0);
  });

  it('refuses other DICOMweb paths', async () => {
    await request(app(['*'])).get('/dicom-web/').set('Cookie', withSession).expect(404);
    await request(app(['*'])).get('/dicom-web/series/9.9').set('Cookie', withSession).expect(404);
    expect(seen.filter((call) => call.url === '/dicom-web/' || call.url?.startsWith('/dicom-web/series/9.9'))).toHaveLength(0);
  });

  it('is read-only', async () => {
    for (const method of ['post', 'put', 'delete'] as const) {
      await request(app(['*']))[method](`/dicom-web/studies/${OWN_STUDY}`).set('Cookie', withSession).expect(405);
    }
    expect(seen.filter((call) => call.method !== 'GET' && call.method !== 'HEAD')).toHaveLength(0);
  });

  it('never passes an Orthanc Basic-auth challenge to the browser', async () => {
    process.env.ORTHANC_PASSWORD = 'wrong';
    const res = await request(app(['clinical'])).get('/ohif/viewer').set('Cookie', withSession).expect(502);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('builds service credentials only when a username is configured', () => {
    expect(orthancAuthHeaders()).toEqual({ Authorization: SERVICE_AUTH });
    delete process.env.ORTHANC_USERNAME;
    expect(orthancAuthHeaders()).toEqual({});
  });
});
