import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import request from 'supertest';
import { PACS_VIEWER_PATHS, pacsViewerProxy } from './pacs-viewer.proxy';
import { orthancAuthHeaders } from './orthanc-connection';

const SERVICE_AUTH = `Basic ${Buffer.from('hospital-api:service-secret').toString('base64')}`;

describe('PACS viewer proxy (24.5)', () => {
  let orthanc: Server;
  const seen: Array<{ method?: string; url?: string; authorization?: string; cookie?: string }> = [];
  const env = { ...process.env };

  beforeAll(async () => {
    // Fake Orthanc: requires the service credentials, like the real one.
    orthanc = createServer((req, res) => {
      seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie });
      if (req.headers.authorization !== SERVICE_AUTH) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="Orthanc"' }).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/dicom+json', 'set-cookie': 'orthanc=1' }).end('[{"ok":true}]');
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

  const app = (permissions: string[] | null) => {
    const auth = { getSession: (id?: string) => (id === 'valid-token' && permissions ? { permissions } : undefined) };
    const server = express();
    server.use(PACS_VIEWER_PATHS, pacsViewerProxy(auth as never));
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

  it('forwards reads with the service credentials, not the EHR cookie', async () => {
    const res = await request(app(['radiology'])).get('/dicom-web/studies?StudyInstanceUID=1.2.3').set('Cookie', withSession).expect(200);
    expect(res.body).toEqual([{ ok: true }]);
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/dicom-web/studies?StudyInstanceUID=1.2.3', authorization: SERVICE_AUTH });
    expect(seen[0].cookie).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('is read-only', async () => {
    for (const method of ['post', 'put', 'delete'] as const) {
      await request(app(['*']))[method]('/dicom-web/studies/1.2.3').set('Cookie', withSession).expect(405);
    }
    expect(seen).toHaveLength(0);
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
