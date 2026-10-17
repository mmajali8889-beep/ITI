import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import axios from 'axios';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Edit3,
  Loader2,
  MapPin,
  Network,
  Plus,
  Power,
  RefreshCw,
  Save,
  Server,
  Wifi,
  X,
} from 'lucide-react';
import {
  Link,
  useParams,
} from 'react-router-dom';

import {
  createRadiologyStation,
  deactivateRadiologyStation,
  echoRadiologyStation,
  getRadiologyStations,
  syncHospitalRadiologyStations,
  syncRadiologyStationToOrthanc,
  updateRadiologyStation,
} from '../api/radiologyStationApi';

import type {
  RadiologyStation,
  SaveRadiologyStationPayload,
} from '../types/radiologyStation';

import './RadiologyStationsPage.css';

const MODALITIES = [
  'CT',
  'MR',
  'XR',
  'DX',
  'US',
  'MG',
  'NM',
  'PT',
  'OTHER',
];

type FormState = {
  name: string;
  modality: string;
  aet: string;
  ipAddress: string;
  port: string;
  room: string;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  modality: 'CT',
  aet: '',
  ipAddress: '',
  port: '104',
  room: '',
  active: true,
};

export default function RadiologyStationsPage() {
  const { hospitalId } = useParams<{
    hospitalId: string;
  }>();

  const [
    stations,
    setStations,
  ] = useState<RadiologyStation[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [
    workingStationId,
    setWorkingStationId,
  ] = useState<string | null>(null);

  const [
    syncingAll,
    setSyncingAll,
  ] = useState(false);

  const [
    editingStation,
    setEditingStation,
  ] = useState<RadiologyStation | null>(
    null,
  );

  const [form, setForm] =
    useState<FormState>(
      EMPTY_FORM,
    );

  const [error, setError] =
    useState('');

  const [notice, setNotice] =
    useState('');

  const load = useCallback(
    async () => {
      if (!hospitalId) {
        return;
      }

      try {
        setLoading(true);
        setError('');

        const result =
          await getRadiologyStations({
            hospitalId,
          });

        setStations(
          result.stations,
        );
      } catch (err) {
        setError(
          errorMessage(
            err,
            'Unable to load modality stations.',
          ),
        );
      } finally {
        setLoading(false);
      }
    },
    [hospitalId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount =
    useMemo(
      () =>
        stations.filter(
          (station) =>
            station.active,
        ).length,
      [stations],
    );

  const modalityCount =
    useMemo(
      () =>
        new Set(
          stations
            .filter(
              (station) =>
                station.active,
            )
            .map(
              (station) =>
                station.modality,
            ),
        ).size,
      [stations],
    );

  function updateForm(
    key: keyof FormState,
    value:
      string | boolean,
  ) {
    setForm((current) => ({
      ...current,
      [key]:
        key === 'aet' &&
        typeof value ===
          'string'
          ? value.toUpperCase()
          : value,
    }));
  }

  function resetForm() {
    setEditingStation(null);
    setForm(
      EMPTY_FORM,
    );
  }

  function editStation(
    station:
      RadiologyStation,
  ) {
    setEditingStation(
      station,
    );

    setForm({
      name:
        station.name,
      modality:
        station.modality,
      aet:
        station.aet,
      ipAddress:
        station.ipAddress ??
        '',
      port:
        station.port
          ? String(
              station.port,
            )
          : '',
      room:
        station.room ??
        '',
      active:
        station.active,
    });

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }

  async function submit(
    event:
      FormEvent,
  ) {
    event.preventDefault();

    if (!hospitalId) {
      return;
    }

    const port =
      form.port.trim()
        ? Number(
            form.port,
          )
        : undefined;

    const payload:
      SaveRadiologyStationPayload = {
        hospitalId,
        name:
          form.name.trim(),
        modality:
          form.modality,
        aet:
          form.aet
            .trim()
            .toUpperCase(),
        ipAddress:
          form.ipAddress
            .trim() ||
          undefined,
        port,
        room:
          form.room
            .trim() ||
          undefined,
        active:
          form.active,
      };

    try {
      setSaving(true);
      setError('');
      setNotice('');

      const saved =
        editingStation
          ? await updateRadiologyStation(
              editingStation.id,
              payload,
            )
          : await createRadiologyStation(
              payload,
            );

      const orthancMessage =
        saved.orthanc
          ?.registered
          ? ' Registered in Orthanc.'
          : saved.orthanc
              ?.syncFailed
            ? ` Saved, but Orthanc sync failed: ${saved.orthanc.error}`
            : saved.orthanc
                ?.skipped
              ? ` Saved. Orthanc sync skipped: ${saved.orthanc.reason}`
              : '';

      setNotice(
        `${
          editingStation
            ? 'Modality station updated successfully.'
            : 'Modality station created successfully.'
        }${orthancMessage}`,
      );

      resetForm();
      await load();
    } catch (err) {
      setError(
        errorMessage(
          err,
          'Unable to save modality station.',
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(
    station:
      RadiologyStation,
  ) {
    if (
      !window.confirm(
        `Deactivate ${station.name} (${station.aet})?`,
      )
    ) {
      return;
    }

    try {
      setError('');
      setNotice('');

      await deactivateRadiologyStation(
        station.id,
      );

      setNotice(
        `${station.name} is now inactive.`,
      );

      await load();
    } catch (err) {
      setError(
        errorMessage(
          err,
          'Unable to deactivate modality station.',
        ),
      );
    }
  }

  async function activate(
    station:
      RadiologyStation,
  ) {
    try {
      setError('');
      setNotice('');

      await updateRadiologyStation(
        station.id,
        {
          active: true,
        },
      );

      setNotice(
        `${station.name} is active.`,
      );

      await load();
    } catch (err) {
      setError(
        errorMessage(
          err,
          'Unable to activate modality station.',
        ),
      );
    }
  }

  async function syncOne(
    station:
      RadiologyStation,
  ) {
    try {
      setWorkingStationId(
        station.id,
      );
      setError('');
      setNotice('');

      const result =
        await syncRadiologyStationToOrthanc(
          station.id,
        );

      setNotice(
        `${station.name} registered in Orthanc as ${result.orthancId}. MWL C-FIND is allowed; historical study C-FIND remains blocked.`,
      );

      await load();
    } catch (err) {
      setError(
        errorMessage(
          err,
          'Unable to register station in Orthanc.',
        ),
      );
    } finally {
      setWorkingStationId(
        null,
      );
    }
  }

  async function echoOne(
    station:
      RadiologyStation,
  ) {
    try {
      setWorkingStationId(
        station.id,
      );
      setError('');
      setNotice('');

      const result =
        await echoRadiologyStation(
          station.id,
        );

      setNotice(
        `C-ECHO successful: ${result.aet} at ${result.host}:${result.port} responded in ${result.elapsedMs} ms.`,
      );
    } catch (err) {
      setError(
        errorMessage(
          err,
          'C-ECHO failed. Check modality AE Title, IP, DICOM port, firewall and routing.',
        ),
      );
    } finally {
      setWorkingStationId(
        null,
      );
    }
  }

  async function syncAll() {
    if (!hospitalId) {
      return;
    }

    try {
      setSyncingAll(
        true,
      );
      setError('');
      setNotice('');

      const result =
        await syncHospitalRadiologyStations(
          hospitalId,
        );

      setNotice(
        `Orthanc registry synchronization completed for ${result.total ?? stations.length} station(s).`,
      );
    } catch (err) {
      setError(
        errorMessage(
          err,
          'Unable to synchronize hospital stations with Orthanc.',
        ),
      );
    } finally {
      setSyncingAll(
        false,
      );
    }
  }

  return (
    <main className="stations-root">
      <section className="stations-hero">
        <div>
          <div className="stations-kicker">
            <Activity size={15} />
            RADIOLOGY CONFIGURATION
          </div>

          <h1>
            Modality Stations
          </h1>

          <p>
            Manage DICOM AE Titles,
            modality type, network
            address, room and station
            availability for this
            hospital.
          </p>
        </div>

        <div className="stations-hero-actions">
          <Link
            to={`/hospital/${hospitalId}/radiology`}
            className="stations-back"
          >
            <ArrowLeft size={16} />
            RIS Worklist
          </Link>

          <button
            type="button"
            disabled={syncingAll}
            onClick={() =>
              void syncAll()
            }
          >
            {syncingAll ? (
              <Loader2
                size={16}
                className="stations-spin"
              />
            ) : (
              <Server size={16} />
            )}
            Sync Orthanc
          </button>

          <button
            type="button"
            onClick={() =>
              void load()
            }
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </section>

      {error && (
        <div className="stations-alert error">
          <AlertTriangle size={17} />
          <span>{error}</span>
          <button
            type="button"
            onClick={() =>
              setError('')
            }
          >
            <X size={15} />
          </button>
        </div>
      )}

      {notice && (
        <div className="stations-alert success">
          <CheckCircle2 size={17} />
          <span>{notice}</span>
          <button
            type="button"
            onClick={() =>
              setNotice('')
            }
          >
            <X size={15} />
          </button>
        </div>
      )}

      <section className="stations-stats">
        <div>
          <Cpu size={18} />
          <span>Total Stations</span>
          <strong>
            {stations.length}
          </strong>
        </div>

        <div>
          <Power size={18} />
          <span>Active</span>
          <strong>
            {activeCount}
          </strong>
        </div>

        <div>
          <Server size={18} />
          <span>Modalities</span>
          <strong>
            {modalityCount}
          </strong>
        </div>

        <div>
          <MapPin size={18} />
          <span>Hospital</span>
          <strong className="hospital-id">
            {hospitalId}
          </strong>
        </div>
      </section>

      <section className="stations-layout">
        <form
          className="stations-form"
          onSubmit={
            submit
          }
        >
          <header>
            <div>
              <span>
                {editingStation
                  ? 'EDIT STATION'
                  : 'NEW STATION'}
              </span>

              <h2>
                {editingStation
                  ? editingStation.name
                  : 'Add Modality Station'}
              </h2>
            </div>

            {editingStation && (
              <button
                type="button"
                className="stations-clear"
                onClick={
                  resetForm
                }
              >
                <X size={16} />
              </button>
            )}
          </header>

          <label>
            <span>
              Station Name
            </span>
            <input
              required
              maxLength={16}
              value={
                form.name
              }
              placeholder="CT Room 1"
              onChange={(event) =>
                updateForm(
                  'name',
                  event.target.value,
                )
              }
            />
            <small>
              Maximum 16 characters
              because the value is sent
              as DICOM ScheduledStationName.
            </small>
          </label>

          <div className="stations-form-grid">
            <label>
              <span>
                Modality
              </span>
              <select
                value={
                  form.modality
                }
                onChange={(event) =>
                  updateForm(
                    'modality',
                    event.target.value,
                  )
                }
              >
                {MODALITIES.map(
                  (item) => (
                    <option
                      key={item}
                      value={item}
                    >
                      {item}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label>
              <span>
                AE Title
              </span>
              <input
                required
                maxLength={16}
                value={
                  form.aet
                }
                placeholder="CT01"
                onChange={(event) =>
                  updateForm(
                    'aet',
                    event.target.value,
                  )
                }
              />
            </label>
          </div>

          <div className="stations-form-grid">
            <label>
              <span>
                IP / Hostname
              </span>
              <input
                value={
                  form.ipAddress
                }
                placeholder="10.20.30.41"
                onChange={(event) =>
                  updateForm(
                    'ipAddress',
                    event.target.value,
                  )
                }
              />
            </label>

            <label>
              <span>
                DICOM Port
              </span>
              <input
                type="number"
                min={1}
                max={65535}
                value={
                  form.port
                }
                placeholder="104"
                onChange={(event) =>
                  updateForm(
                    'port',
                    event.target.value,
                  )
                }
              />
            </label>
          </div>

          <label>
            <span>
              Room / Location
            </span>
            <input
              value={
                form.room
              }
              placeholder="Radiology - CT Suite"
              onChange={(event) =>
                updateForm(
                  'room',
                  event.target.value,
                )
              }
            />
          </label>

          <label className="stations-toggle">
            <input
              type="checkbox"
              checked={
                form.active
              }
              onChange={(event) =>
                updateForm(
                  'active',
                  event.target.checked,
                )
              }
            />

            <div>
              <strong>
                Active Station
              </strong>
              <span>
                Available for RIS
                scheduling and DICOM MWL.
              </span>
            </div>
          </label>

          <button
            type="submit"
            className="stations-save"
            disabled={
              saving
            }
          >
            {saving ? (
              <Loader2
                size={16}
                className="stations-spin"
              />
            ) : editingStation ? (
              <Save size={16} />
            ) : (
              <Plus size={16} />
            )}

            {editingStation
              ? 'Save Changes'
              : 'Add Station'}
          </button>
        </form>

        <section className="stations-list">
          <header>
            <div>
              <span>
                CONFIGURED DEVICES
              </span>
              <h2>
                Hospital Stations
              </h2>
            </div>

            <strong>
              {stations.length}
            </strong>
          </header>

          {loading ? (
            <div className="stations-state">
              <Loader2
                size={28}
                className="stations-spin"
              />
              Loading stations
            </div>
          ) : stations.length ===
            0 ? (
            <div className="stations-state">
              <Cpu size={30} />
              <strong>
                No modality stations
              </strong>
              <span>
                Add CT01, MR01,
                XR01, US01 or another
                station using the form.
              </span>
            </div>
          ) : (
            <div className="stations-cards">
              {stations.map(
                (station) => (
                  <article
                    key={
                      station.id
                    }
                    className={
                      station.active
                        ? ''
                        : 'inactive'
                    }
                  >
                    <div className="station-top">
                      <span className="station-modality">
                        {
                          station.modality
                        }
                      </span>

                      <span
                        className={`station-status ${
                          station.active
                            ? 'active'
                            : 'inactive'
                        }`}
                      >
                        {station.active
                          ? 'Active'
                          : 'Inactive'}
                      </span>
                    </div>

                    <h3>
                      {station.name}
                    </h3>

                    <div className="station-aet">
                      <Network
                        size={14}
                      />
                      <strong>
                        {
                          station.aet
                        }
                      </strong>
                    </div>

                    <dl>
                      <div>
                        <dt>
                          IP
                        </dt>
                        <dd>
                          {station.ipAddress ||
                            '—'}
                        </dd>
                      </div>

                      <div>
                        <dt>
                          Port
                        </dt>
                        <dd>
                          {station.port ||
                            '—'}
                        </dd>
                      </div>

                      <div>
                        <dt>
                          Room
                        </dt>
                        <dd>
                          {station.room ||
                            '—'}
                        </dd>
                      </div>
                    </dl>

                    <footer>
                      <button
                        type="button"
                        disabled={
                          !station.active ||
                          !station.ipAddress ||
                          !station.port ||
                          workingStationId ===
                            station.id
                        }
                        onClick={() =>
                          void syncOne(
                            station,
                          )
                        }
                      >
                        {workingStationId ===
                          station.id ? (
                          <Loader2
                            size={14}
                            className="stations-spin"
                          />
                        ) : (
                          <Server
                            size={14}
                          />
                        )}
                        Sync PACS
                      </button>

                      <button
                        type="button"
                        className="echo"
                        disabled={
                          !station.active ||
                          !station.ipAddress ||
                          !station.port ||
                          workingStationId ===
                            station.id
                        }
                        onClick={() =>
                          void echoOne(
                            station,
                          )
                        }
                      >
                        <Wifi
                          size={14}
                        />
                        C-ECHO
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          editStation(
                            station,
                          )
                        }
                      >
                        <Edit3
                          size={14}
                        />
                        Edit
                      </button>

                      {station.active ? (
                        <button
                          type="button"
                          className="danger"
                          onClick={() =>
                            void deactivate(
                              station,
                            )
                          }
                        >
                          <Power
                            size={14}
                          />
                          Deactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="activate"
                          onClick={() =>
                            void activate(
                              station,
                            )
                          }
                        >
                          <Power
                            size={14}
                          />
                          Activate
                        </button>
                      )}
                    </footer>
                  </article>
                ),
              )}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function errorMessage(
  error:
    unknown,
  fallback:
    string,
) {
  if (
    axios.isAxiosError(
      error,
    )
  ) {
    const message =
      error.response
        ?.data
        ?.message;

    if (
      typeof message ===
        'string'
    ) {
      return message;
    }

    if (
      Array.isArray(
        message,
      )
    ) {
      return message.join(
        ', ',
      );
    }
  }

  if (
    error instanceof Error
  ) {
    return error.message;
  }

  return fallback;
}
