import { PacsStudyAccessService } from './pacs-study-access.service';

const study = (uid: string, patientId: string) => ({
  resourceType: 'ImagingStudy',
  identifier: [{ system: 'urn:dicom:uid', value: `urn:oid:${uid}` }],
  subject: { reference: `Patient/${patientId}` },
});
const patients: Record<string, string> = { pa: 'hospital-a', pb: 'hospital-b' };

function service(studies: ReturnType<typeof study>[]) {
  const client = {
    searchResources: jest.fn(async (_type: string, query: { identifier: string }) => {
      const wanted = query.identifier.split(',').map((value) => value.replace('urn:dicom:uid|urn:oid:', ''));
      return studies.filter((item) => wanted.includes(item.identifier[0].value.replace('urn:oid:', '')));
    }),
    readResource: jest.fn(async (_type: string, id: string) => ({ resourceType: 'Patient', id, managingOrganization: { reference: `Organization/${patients[id]}` } })),
  };
  return { client, access: new PacsStudyAccessService({ getClient: () => client } as never) };
}

describe('PacsStudyAccessService (26.4)', () => {
  it('allows only studies linked to a patient of the session hospital', async () => {
    const { access } = service([study('1.1', 'pa'), study('2.2', 'pb')]);
    expect([...(await access.allowedUids(['1.1', '2.2', '3.3'], 'hospital-a'))]).toEqual(['1.1']);
    expect(await access.isAllowed('2.2', 'hospital-b')).toBe(true);
    expect(await access.isAllowed('2.2', 'hospital-a')).toBe(false);
  });

  it('hides a study that is linked to patients of two hospitals', async () => {
    const { access } = service([study('4.4', 'pa'), study('4.4', 'pb')]);
    expect(await access.isAllowed('4.4', 'hospital-a')).toBe(false);
    expect(await access.isAllowed('4.4', 'hospital-b')).toBe(false);
  });

  it('hides studies not yet linked to an order', async () => {
    const { access } = service([]);
    expect(await access.isAllowed('5.5', 'hospital-a')).toBe(false);
  });

  it('caches decisions so frame requests do not each query Medplum', async () => {
    const { access, client } = service([study('1.1', 'pa')]);
    for (let i = 0; i < 20; i += 1) await access.isAllowed('1.1', 'hospital-a');
    expect(client.searchResources).toHaveBeenCalledTimes(1);
    expect(client.readResource).toHaveBeenCalledTimes(1);
  });

  it('looks up a whole search page in one Medplum query', async () => {
    const { access, client } = service([study('1.1', 'pa'), study('1.2', 'pa'), study('1.3', 'pb')]);
    await access.allowedUids(['1.1', '1.2', '1.3'], 'hospital-a');
    expect(client.searchResources).toHaveBeenCalledTimes(1);
  });
});
