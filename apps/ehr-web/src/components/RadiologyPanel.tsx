import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  AlertTriangle,
  CheckCircle2,
  CirclePause,
  Clock3,
  FilePlus2,
  Image,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  FileText,
  ExternalLink,
  X,
} from 'lucide-react';

import {
  createRadiologyOrder,
  getEncounterRadiologyOrders,
  updateRadiologyOrderStatus,
} from '../api/radiologyApi';

import { getPacsStudies, openPacsStudy, type PacsStudy } from '../api/radiologyPacsApi';

import type {
  CreateRadiologyOrderRequest,
  RadiologyModality,
  RadiologyOrder,
  RadiologyOrderStatus,
  RadiologyPriority,
} from '../types/radiology';

import RadiologyReport from './RadiologyReport';

import './RadiologyPanel.css';

interface Props {
  patientId: string;
  encounterId: string;
  hospitalId: string;
  practitionerId?: string;
  practitionerName?: string;
  readOnly?: boolean;
}

type Filter =
  | 'all'
  | 'active'
  | 'urgent'
  | 'completed'
  | 'on-hold';

interface OrderForm {
  examCode: string;
  examName: string;
  modality: RadiologyModality;
  bodySiteCode: string;
  bodySiteName: string;
  priority: RadiologyPriority;
  clinicalIndication: string;
  clinicalQuestion: string;
  notes: string;
}

const EMPTY_FORM: OrderForm = {
  examCode: '',
  examName: '',
  modality: 'XR',
  bodySiteCode: '',
  bodySiteName: '',
  priority: 'routine',
  clinicalIndication: '',
  clinicalQuestion: '',
  notes: '',
};

const EXAM_PRESETS: Array<{
  code: string;
  name: string;
  modality: RadiologyModality;
  bodySiteName: string;
}> = [
  {
    code: 'CXR-PA',
    name: 'Chest X-Ray PA',
    modality: 'XR',
    bodySiteName: 'Chest',
  },
  {
    code: 'CXR-2V',
    name: 'Chest X-Ray PA & Lateral',
    modality: 'XR',
    bodySiteName: 'Chest',
  },
  {
    code: 'CT-BRAIN-NC',
    name: 'CT Brain Without Contrast',
    modality: 'CT',
    bodySiteName: 'Head',
  },
  {
    code: 'CT-ABD-PEL',
    name: 'CT Abdomen & Pelvis',
    modality: 'CT',
    bodySiteName: 'Abdomen and pelvis',
  },
  {
    code: 'MR-LSPINE',
    name: 'MRI Lumbar Spine',
    modality: 'MR',
    bodySiteName: 'Lumbar spine',
  },
  {
    code: 'US-ABD',
    name: 'Ultrasound Abdomen',
    modality: 'US',
    bodySiteName: 'Abdomen',
  },
];

export default function RadiologyPanel({
  patientId,
  encounterId,
  hospitalId,
  practitionerId,
  practitionerName,
  readOnly = false,
}: Props) {
  const [
    orders,
    setOrders,
  ] = useState<RadiologyOrder[]>([]);

  const [pacsStudies, setPacsStudies] = useState<PacsStudy[]>([]);
  const [pacsOnline, setPacsOnline] = useState(true);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState('');

  const [
    success,
    setSuccess,
  ] = useState('');

  const [
    showForm,
    setShowForm,
  ] = useState(false);

  const [
    form,
    setForm,
  ] = useState<OrderForm>(EMPTY_FORM);

  const [
    query,
    setQuery,
  ] = useState('');

  const [
    filter,
    setFilter,
  ] = useState<Filter>('all');

  const [
    updatingOrderId,
    setUpdatingOrderId,
  ] = useState<string | null>(null);

  const [
    reportOrder,
    setReportOrder,
  ] = useState<RadiologyOrder | null>(null);

  const loadOrders =
    useCallback(
      async () => {
        try {
          setLoading(true);
          setError('');

          const response =
            await getEncounterRadiologyOrders(
              encounterId,
            );

          setOrders(
            response.orders ?? [],
          );

          try {
            const pacs = await getPacsStudies();
            setPacsStudies(pacs.studies ?? []);
            setPacsOnline(true);
          } catch (pacsError) {
            console.warn('PACS is unavailable:', pacsError);
            setPacsStudies([]);
            setPacsOnline(false);
          }
        } catch (err) {
          console.error(
            'Unable to load radiology orders:',
            err,
          );

          setError(
            'Unable to load radiology worklist.',
          );
        } finally {
          setLoading(false);
        }
      },
      [encounterId],
    );

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (!success) {
      return;
    }

    const timer =
      window.setTimeout(
        () => setSuccess(''),
        3200,
      );

    return () =>
      window.clearTimeout(timer);
  }, [success]);

  const counts =
    useMemo(
      () => ({
        total: orders.length,

        active:
          orders.filter(
            (order) =>
              order.status === 'active',
          ).length,

        urgent:
          orders.filter(
            (order) =>
              order.priority === 'urgent' ||
              order.priority === 'asap' ||
              order.priority === 'stat',
          ).length,

        completed:
          orders.filter(
            (order) =>
              order.status === 'completed',
          ).length,
      }),
      [orders],
    );

  const visibleOrders =
    useMemo(
      () => {
        const needle =
          query.trim().toLowerCase();

        return orders.filter(
          (order) => {
            const matchesQuery =
              !needle ||
              order.examName
                .toLowerCase()
                .includes(needle) ||
              order.examCode
                ?.toLowerCase()
                .includes(needle) ||
              order.modality
                .toLowerCase()
                .includes(needle) ||
              order.bodySiteName
                ?.toLowerCase()
                .includes(needle) ||
              order.clinicalIndication
                ?.toLowerCase()
                .includes(needle);

            const matchesFilter =
              filter === 'all' ||
              (
                filter === 'active' &&
                order.status === 'active'
              ) ||
              (
                filter === 'completed' &&
                order.status === 'completed'
              ) ||
              (
                filter === 'on-hold' &&
                order.status === 'on-hold'
              ) ||
              (
                filter === 'urgent' &&
                (
                  order.priority === 'urgent' ||
                  order.priority === 'asap' ||
                  order.priority === 'stat'
                )
              );

            return (
              matchesQuery &&
              matchesFilter
            );
          },
        );
      },
      [
        orders,
        query,
        filter,
      ],
    );

  function updateForm<
    K extends keyof OrderForm,
  >(
    key: K,
    value: OrderForm[K],
  ) {
    setForm(
      (current) => ({
        ...current,
        [key]: value,
      }),
    );
  }

  function applyPreset(
    preset:
      (typeof EXAM_PRESETS)[number],
  ) {
    setForm(
      (current) => ({
        ...current,
        examCode: preset.code,
        examName: preset.name,
        modality: preset.modality,
        bodySiteName:
          preset.bodySiteName,
      }),
    );
  }

  async function handleCreateOrder() {
    if (readOnly) {
      return;
    }

    if (
      !form.examCode.trim() ||
      !form.examName.trim()
    ) {
      setError(
        'Exam code and exam name are required.',
      );

      return;
    }

    const payload:
      CreateRadiologyOrderRequest = {
        patientId,
        encounterId,
        hospitalId,

        examCode:
          form.examCode.trim(),

        examName:
          form.examName.trim(),

        modality:
          form.modality,

        priority:
          form.priority,

        bodySiteCode:
          form.bodySiteCode.trim() ||
          undefined,

        bodySiteName:
          form.bodySiteName.trim() ||
          undefined,

        clinicalIndication:
          form.clinicalIndication.trim() ||
          undefined,

        clinicalQuestion:
          form.clinicalQuestion.trim() ||
          undefined,

        requesterId:
          practitionerId,

        requesterName:
          practitionerName,

        notes:
          form.notes.trim() ||
          undefined,
      };

    try {
      setSaving(true);
      setError('');
      setSuccess('');

      await createRadiologyOrder(
        payload,
      );

      setForm(
        EMPTY_FORM,
      );

      setShowForm(
        false,
      );

      setSuccess(
        'Radiology order created successfully.',
      );

      await loadOrders();
    } catch (err) {
      console.error(
        'Unable to create radiology order:',
        err,
      );

      setError(apiMessage(err, 'Unable to create radiology order.'));
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(
    order: RadiologyOrder,
    status: RadiologyOrderStatus,
  ) {
    if (
      readOnly ||
      !order.id
    ) {
      return;
    }

    try {
      setUpdatingOrderId(
        order.id,
      );

      setError('');

      const updated =
        await updateRadiologyOrderStatus(
          order.id,
          status,
          hospitalId,
        );

      setOrders(
        (current) =>
          current.map(
            (item) =>
              item.id === updated.id
                ? updated
                : item,
          ),
      );
    } catch (err) {
      console.error(
        'Unable to update radiology order:',
        err,
      );

      setError(
        'Unable to update radiology order status.',
      );
    } finally {
      setUpdatingOrderId(
        null,
      );
    }
  }

  return (
    <section className="rad-panel">
      <header className="rad-header">
        <div>
          <div className="rad-kicker">
            <Image size={15} />
            RADIOLOGY WORKLIST
          </div>

          <h2>
            Imaging Orders
          </h2>

          <p>
            Create and track imaging requests for this encounter.
          </p>
        </div>

        <div className="rad-header-actions">
          <button
            type="button"
            className="rad-secondary-btn"
            onClick={() =>
              void loadOrders()
            }
          >
            <RefreshCw
              size={16}
            />
            Refresh
          </button>

          {!readOnly && (
            <button
              type="button"
              className="rad-primary-btn"
              onClick={() =>
                setShowForm(true)
              }
            >
              <FilePlus2
                size={16}
              />
              New Imaging Order
            </button>
          )}
        </div>
      </header>

      {readOnly && (
        <div className="rad-readonly">
          <CirclePause
            size={17}
          />

          This encounter is finished. Radiology orders are read-only.
        </div>
      )}

      {error && (
        <div className="rad-alert error">
          <AlertTriangle
            size={17}
          />

          {error}
        </div>
      )}

      {success && (
        <div className="rad-alert success">
          <CheckCircle2
            size={17}
          />

          {success}
        </div>
      )}

      <div className="rad-stats">
        <StatCard
          label="Total Orders"
          value={counts.total}
          icon={
            <Image
              size={17}
            />
          }
        />

        <StatCard
          label="Active"
          value={counts.active}
          icon={
            <Clock3
              size={17}
            />
          }
          tone="blue"
        />

        <StatCard
          label="Urgent / STAT"
          value={counts.urgent}
          icon={
            <ShieldAlert
              size={17}
            />
          }
          tone={
            counts.urgent
              ? 'red'
              : 'default'
          }
        />

        <StatCard
          label="Completed"
          value={counts.completed}
          icon={
            <CheckCircle2
              size={17}
            />
          }
          tone="green"
        />
      </div>

      <div className="rad-toolbar">
        <label className="rad-search">
          <Search
            size={16}
          />

          <input
            value={query}
            onChange={(event) =>
              setQuery(
                event.target.value,
              )
            }
            placeholder="Search exam, modality, body site..."
          />
        </label>

        <div className="rad-filters">
          {(
            [
              ['all', 'All'],
              ['active', 'Active'],
              ['urgent', 'Urgent / STAT'],
              ['on-hold', 'On Hold'],
              ['completed', 'Completed'],
            ] as const
          ).map(
            ([value, label]) => (
              <button
                type="button"
                key={value}
                className={
                  filter === value
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setFilter(value)
                }
              >
                {label}
              </button>
            ),
          )}
        </div>
      </div>

      {loading ? (
        <div className="rad-state">
          <Loader2
            size={28}
            className="rad-spin"
          />

          <strong>
            Loading radiology worklist
          </strong>
        </div>
      ) : visibleOrders.length === 0 ? (
        <div className="rad-state">
          <Image
            size={34}
          />

          <strong>
            No imaging orders found
          </strong>

          <span>
            Create an imaging request to start the radiology workflow.
          </span>
        </div>
      ) : (
        <div className="rad-worklist">
          {visibleOrders.map(
            (order) => (
              <OrderCard
                key={order.id}
                order={order}
                readOnly={
                  readOnly
                }
                updating={
                  updatingOrderId ===
                  order.id
                }
                onStatus={
                  changeStatus
                }
                onOpenReport={
                  setReportOrder
                }
                pacsStudy={findPacsStudyForOrder(order, pacsStudies)}
                pacsOnline={pacsOnline}
              />
            ),
          )}
        </div>
      )}

      {showForm && (
        <div
          className="rad-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.currentTarget ===
              event.target
            ) {
              setShowForm(false);
            }
          }}
        >
          <div
            className="rad-modal"
            role="dialog"
            aria-modal="true"
            aria-label="New radiology order"
          >
            <header className="rad-modal-header">
              <div>
                <div className="rad-kicker">
                  <FilePlus2
                    size={15}
                  />

                  NEW IMAGING REQUEST
                </div>

                <h3>
                  Radiology Order
                </h3>

                <p>
                  Create an encounter-linked FHIR ServiceRequest.
                </p>
              </div>

              <button
                type="button"
                className="rad-icon-btn"
                onClick={() =>
                  setShowForm(false)
                }
              >
                <X
                  size={18}
                />
              </button>
            </header>

            <div className="rad-presets">
              {EXAM_PRESETS.map(
                (preset) => (
                  <button
                    type="button"
                    key={preset.code}
                    onClick={() =>
                      applyPreset(
                        preset,
                      )
                    }
                  >
                    <strong>
                      {preset.name}
                    </strong>

                    <span>
                      {preset.modality}
                    </span>
                  </button>
                ),
              )}
            </div>

            <div className="rad-form-grid">
              <Field
                label="Exam Code"
              >
                <input
                  value={
                    form.examCode
                  }
                  onChange={(event) =>
                    updateForm(
                      'examCode',
                      event.target.value,
                    )
                  }
                  placeholder="e.g. CXR-PA"
                />
              </Field>

              <Field
                label="Exam Name"
              >
                <input
                  value={
                    form.examName
                  }
                  onChange={(event) =>
                    updateForm(
                      'examName',
                      event.target.value,
                    )
                  }
                  placeholder="e.g. Chest X-Ray PA"
                />
              </Field>

              <Field
                label="Modality"
              >
                <select
                  value={
                    form.modality
                  }
                  onChange={(event) =>
                    updateForm(
                      'modality',
                      event.target.value as RadiologyModality,
                    )
                  }
                >
                  <option value="XR">
                    X-Ray
                  </option>

                  <option value="CT">
                    CT
                  </option>

                  <option value="MR">
                    MRI
                  </option>

                  <option value="US">
                    Ultrasound
                  </option>

                  <option value="MG">
                    Mammography
                  </option>

                  <option value="NM">
                    Nuclear Medicine
                  </option>

                  <option value="PT">
                    PET
                  </option>

                  <option value="DX">
                    Digital Radiography
                  </option>

                  <option value="OTHER">
                    Other
                  </option>
                </select>
              </Field>

              <Field
                label="Priority"
              >
                <select
                  value={
                    form.priority
                  }
                  onChange={(event) =>
                    updateForm(
                      'priority',
                      event.target.value as RadiologyPriority,
                    )
                  }
                >
                  <option value="routine">
                    Routine
                  </option>

                  <option value="urgent">
                    Urgent
                  </option>

                  <option value="asap">
                    ASAP
                  </option>

                  <option value="stat">
                    STAT
                  </option>
                </select>
              </Field>

              <Field
                label="Body Site Code"
              >
                <input
                  value={
                    form.bodySiteCode
                  }
                  onChange={(event) =>
                    updateForm(
                      'bodySiteCode',
                      event.target.value,
                    )
                  }
                  placeholder="Optional SNOMED code"
                />
              </Field>

              <Field
                label="Body Site"
              >
                <input
                  value={
                    form.bodySiteName
                  }
                  onChange={(event) =>
                    updateForm(
                      'bodySiteName',
                      event.target.value,
                    )
                  }
                  placeholder="e.g. Chest"
                />
              </Field>

              <Field
                label="Clinical Indication"
                wide
              >
                <textarea
                  value={
                    form.clinicalIndication
                  }
                  onChange={(event) =>
                    updateForm(
                      'clinicalIndication',
                      event.target.value,
                    )
                  }
                  placeholder="Reason for imaging, symptoms, diagnosis..."
                  rows={3}
                />
              </Field>

              <Field
                label="Clinical Question"
                wide
              >
                <textarea
                  value={
                    form.clinicalQuestion
                  }
                  onChange={(event) =>
                    updateForm(
                      'clinicalQuestion',
                      event.target.value,
                    )
                  }
                  placeholder="What clinical question should the radiologist answer?"
                  rows={3}
                />
              </Field>

              <Field
                label="Notes"
                wide
              >
                <textarea
                  value={
                    form.notes
                  }
                  onChange={(event) =>
                    updateForm(
                      'notes',
                      event.target.value,
                    )
                  }
                  placeholder="Additional instructions..."
                  rows={2}
                />
              </Field>
            </div>

            <footer className="rad-modal-footer">
              <button
                type="button"
                className="rad-secondary-btn"
                onClick={() =>
                  setShowForm(false)
                }
                disabled={
                  saving
                }
              >
                Cancel
              </button>

              <button
                type="button"
                className="rad-primary-btn"
                onClick={() =>
                  void handleCreateOrder()
                }
                disabled={
                  saving
                }
              >
                {saving ? (
                  <Loader2
                    size={16}
                    className="rad-spin"
                  />
                ) : (
                  <Send
                    size={16}
                  />
                )}

                {saving
                  ? 'Creating...'
                  : 'Create Imaging Order'}
              </button>
            </footer>
          </div>
        </div>
      )}
      {reportOrder && (
        <RadiologyReport
          order={reportOrder}
          patientId={patientId}
          encounterId={encounterId}
          hospitalId={hospitalId}
          practitionerId={practitionerId}
          practitionerName={practitionerName}
          readOnly={readOnly}
          onClose={() => setReportOrder(null)}
          onChanged={() => void loadOrders()}
        />
      )}
    </section>
  );
}

function apiMessage(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string | { message?: string } } } }).response?.data?.message;
  return typeof message === 'string' ? message : message?.message ?? fallback;
}

function StatCard({
  label,
  value,
  icon,
  tone = 'default',
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?:
    | 'default'
    | 'blue'
    | 'red'
    | 'green';
}) {
  return (
    <div
      className={`rad-stat ${tone}`}
    >
      <div
        className="rad-stat-icon"
      >
        {icon}
      </div>

      <span>
        {label}
      </span>

      <strong>
        {value}
      </strong>
    </div>
  );
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label
      className={
        wide
          ? 'rad-field wide'
          : 'rad-field'
      }
    >
      <span>
        {label}
      </span>

      {children}
    </label>
  );
}

function OrderCard({
  order,
  readOnly,
  updating,
  onStatus,
  onOpenReport,
  pacsStudy,
  pacsOnline,
}: {
  order: RadiologyOrder;
  readOnly: boolean;
  updating: boolean;
  onStatus: (
    order: RadiologyOrder,
    status: RadiologyOrderStatus,
  ) => Promise<void>;
  onOpenReport: (order: RadiologyOrder) => void;
  pacsStudy?: PacsStudy;
  pacsOnline: boolean;
}) {
  const priorityClass =
    priorityTone(
      order.priority,
    );

  return (
    <article
      className={`rad-order-card ${priorityClass}`}
    >
      <div className="rad-order-main">
        <div
          className={`rad-modality modality-${order.modality.toLowerCase()}`}
        >
          {order.modality}
        </div>

        <div className="rad-order-copy">
          <div className="rad-order-title-row">
            <h3>
              {order.examName}
            </h3>

            <span
              className={`rad-priority ${priorityClass}`}
            >
              {order.priority.toUpperCase()}
            </span>

            <span
              className={`rad-status status-${order.status}`}
            >
              {formatStatus(
                order.status,
              )}
            </span>
          </div>

          <div className="rad-order-meta">
            <span>
              Code:
              {' '}
              <strong>
                {order.examCode ||
                  '—'}
              </strong>
            </span>

            <span>
              Body:
              {' '}
              <strong>
                {order.bodySiteName ||
                  '—'}
              </strong>
            </span>

            <span>
              Ordered:
              {' '}
              <strong>
                {formatDateTime(
                  order.authoredOn,
                )}
              </strong>
            </span>

            <span>
              Requester:
              {' '}
              <strong>
                {order.requesterName ||
                  '—'}
              </strong>
            </span>
          </div>

          {order.clinicalIndication && (
            <div className="rad-clinical-block">
              <span>
                Clinical indication
              </span>

              <p>
                {
                  order.clinicalIndication
                }
              </p>
            </div>
          )}

          {order.clinicalQuestion && (
            <div className="rad-clinical-block question">
              <span>
                Clinical question
              </span>

              <p>
                {
                  order.clinicalQuestion
                }
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="rad-order-actions">
        {pacsStudy?.studyInstanceUid ? (
          <button
            type="button"
            className="report"
            onClick={() => openPacsStudy(pacsStudy)}
            title="Open DICOM images in OHIF"
          >
            <ExternalLink size={15} />
            View Images
          </button>
        ) : (
          <span className="rad-pacs-state">
            {pacsOnline ? 'Awaiting Images' : 'PACS Offline'}
          </span>
        )}

        <button
          type="button"
          className="report"
          onClick={() => onOpenReport(order)}
        >
          <FileText size={15} />
          Open Report
        </button>

        {updating ? (
          <Loader2
            size={17}
            className="rad-spin"
          />
        ) : (
          <>
            {order.status ===
              'active' && (
              <button
                type="button"
                onClick={() =>
                  void onStatus(
                    order,
                    'on-hold',
                  )
                }
                disabled={
                  readOnly
                }
              >
                <CirclePause
                  size={15}
                />
                Hold
              </button>
            )}

            {order.status ===
              'on-hold' && (
              <button
                type="button"
                onClick={() =>
                  void onStatus(
                    order,
                    'active',
                  )
                }
                disabled={
                  readOnly
                }
              >
                <Clock3
                  size={15}
                />
                Resume
              </button>
            )}

            {order.status !==
              'completed' &&
              order.status !==
                'revoked' &&
              order.status !==
                'entered-in-error' && (
                <button
                  type="button"
                  className="complete"
                  onClick={() =>
                    void onStatus(
                      order,
                      'completed',
                    )
                  }
                  disabled={
                    readOnly
                  }
                >
                  <CheckCircle2
                    size={15}
                  />
                  Complete
                </button>
              )}
          </>
        )}
      </div>
    </article>
  );
}

function findPacsStudyForOrder(
  order: RadiologyOrder,
  studies: PacsStudy[],
): PacsStudy | undefined {
  const accession = (
    order as RadiologyOrder & {
      accessionNumber?: string;
    }
  ).accessionNumber;

  if (accession) {
    const byAccession = studies.find(
      (study) => study.accessionNumber === accession,
    );

    if (byAccession) {
      return byAccession;
    }
  }

  const examName = order.examName?.trim().toLowerCase();

  if (!examName) {
    return undefined;
  }

  return studies.find((study) =>
    study.studyDescription
      ?.trim()
      .toLowerCase()
      .includes(examName),
  );
}

function priorityTone(
  priority: RadiologyPriority,
) {
  if (
    priority === 'stat' ||
    priority === 'asap'
  ) {
    return 'critical';
  }

  if (
    priority === 'urgent'
  ) {
    return 'urgent';
  }

  return 'routine';
}

function formatStatus(
  status: RadiologyOrderStatus,
) {
  if (
    status ===
    'entered-in-error'
  ) {
    return 'ERROR';
  }

  return status
    .replace('-', ' ')
    .toUpperCase();
}

function formatDateTime(
  value?: string,
) {
  if (!value) {
    return '—';
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return '—';
  }

  return date.toLocaleString();
}
