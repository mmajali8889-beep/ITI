import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Image,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ShieldAlert,
  Stethoscope,
  UserRound,
  UserRoundCheck,
  UserRoundX,
} from 'lucide-react';
import { useParams } from 'react-router-dom';

import {
  assignRadiologist,
  getImagingStudiesByOrder,
  getRadiologists,
  getRisRadiologyWorklist,
  openOhifStudy,
  unassignRadiologist,
  updateRadiologyWorkflow,
} from '../api/radiologyWorklistApi';
import type {
  RadiologistDirectoryItem,
  RadiologyWorkflowStatus,
  RisRadiologyOrder,
  RisWorklistResponse,
} from '../types/radiologyWorklist';
import RadiologyReport from './RadiologyReport';

import './RadiologyWorklistPage.css';

type WorkflowFilter =
  | 'all'
  | RadiologyWorkflowStatus;

type AssignmentView =
  | 'all'
  | 'unassigned'
  | 'mine';

const WORKFLOW_STEPS: RadiologyWorkflowStatus[] = [
  'ordered',
  'scheduled',
  'arrived',
  'exam-started',
  'acquired',
  'images-available',
  'reporting',
  'preliminary',
  'final',
];

const EMPTY_RESPONSE: RisWorklistResponse = {
  total: 0,
  returned: 0,
  limit: 200,
  summary: {
    total: 0,
    active: 0,
    urgent: 0,
    imagesAvailable: 0,
    reporting: 0,
    final: 0,
    assigned: 0,
    unassigned: 0,
  },
  filters: {},
  orders: [],
};

export default function RadiologyWorklistPage() {
  const { hospitalId } = useParams<{
    hospitalId: string;
  }>();

  const [data, setData] =
    useState<RisWorklistResponse>(
      EMPTY_RESPONSE,
    );

  const [radiologists, setRadiologists] =
    useState<RadiologistDirectoryItem[]>([]);

  const [currentRadiologistId, setCurrentRadiologistId] =
    useState('');

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState('');

  const [query, setQuery] =
    useState('');

  const [modality, setModality] =
    useState('all');

  const [workflowFilter, setWorkflowFilter] =
    useState<WorkflowFilter>('all');

  const [assignmentView, setAssignmentView] =
    useState<AssignmentView>('all');

  const [priority, setPriority] =
    useState('all');

  const [updatingOrderId, setUpdatingOrderId] =
    useState<string | null>(null);

  const [assigningOrderId, setAssigningOrderId] =
    useState<string | null>(null);

  const [openingImagesId, setOpeningImagesId] =
    useState<string | null>(null);

  const [reportOrder, setReportOrder] =
    useState<RisRadiologyOrder | null>(null);

  const radiologistStorageKey = hospitalId
    ? `ehr:ris:radiologist:${hospitalId}`
    : 'ehr:ris:radiologist';

  const loadRadiologists = useCallback(
    async () => {
      if (!hospitalId) {
        setRadiologists([]);
        return;
      }

      try {
        const response =
          await getRadiologists(hospitalId);

        const items =
          response.radiologists.filter(
            (item) =>
              item.active &&
              Boolean(item.practitionerId),
          );

        setRadiologists(items);

        const stored =
          window.localStorage.getItem(
            radiologistStorageKey,
          ) ?? '';

        const storedExists = items.some(
          (item) =>
            item.practitionerId === stored,
        );

        if (storedExists) {
          setCurrentRadiologistId(stored);
        } else if (items.length === 1) {
          const onlyId =
            items[0].practitionerId ?? '';
          setCurrentRadiologistId(onlyId);
          if (onlyId) {
            window.localStorage.setItem(
              radiologistStorageKey,
              onlyId,
            );
          }
        } else {
          setCurrentRadiologistId('');
        }
      } catch (err) {
        console.error(
          'Unable to load radiologist directory:',
          err,
        );
        setRadiologists([]);
        setError(
          'Unable to load the active radiologist directory.',
        );
      }
    }, [hospitalId, radiologistStorageKey],
  );

  const load = useCallback(
    async () => {
      try {
        setLoading(true);
        setError('');

        const response =
          await getRisRadiologyWorklist({
            hospitalId:
              hospitalId || undefined,
            q: query.trim() || undefined,
            modality:
              modality === 'all'
                ? undefined
                : modality,
            workflowStatus:
              workflowFilter === 'all'
                ? undefined
                : workflowFilter,
            priority:
              priority === 'all'
                ? undefined
                : priority,
            assignment:
              assignmentView === 'unassigned'
                ? 'unassigned'
                : undefined,
            radiologistId:
              assignmentView === 'mine' &&
              currentRadiologistId
                ? currentRadiologistId
                : undefined,
            limit: 200,
          });

        setData(response);
      } catch (err) {
        console.error(
          'Unable to load RIS worklist:',
          err,
        );

        setError(
          'Unable to load the radiology worklist.',
        );
      } finally {
        setLoading(false);
      }
    }, [
      assignmentView,
      currentRadiologistId,
      hospitalId,
      modality,
      priority,
      query,
      workflowFilter,
    ],
  );

  useEffect(() => {
    void loadRadiologists();
  }, [loadRadiologists]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load(),
      250,
    );

    return () =>
      window.clearTimeout(timer);
  }, [load]);

  const orderedModalities = useMemo(
    () =>
      Array.from(
        new Set(
          data.orders
            .map((order) => order.modality)
            .filter(Boolean),
        ),
      ).sort(),
    [data.orders],
  );

  const currentRadiologist =
    radiologists.find(
      (item) =>
        item.practitionerId ===
        currentRadiologistId,
    );

  function changeCurrentRadiologist(
    practitionerId: string,
  ) {
    setCurrentRadiologistId(
      practitionerId,
    );

    if (practitionerId) {
      window.localStorage.setItem(
        radiologistStorageKey,
        practitionerId,
      );
    } else {
      window.localStorage.removeItem(
        radiologistStorageKey,
      );
    }

    if (
      assignmentView === 'mine' &&
      !practitionerId
    ) {
      setAssignmentView('all');
    }
  }

  async function changeWorkflow(
    order: RisRadiologyOrder,
    next: RadiologyWorkflowStatus,
  ) {
    if (!order.id) {
      return;
    }

    try {
      setUpdatingOrderId(order.id);
      setError('');

      await updateRadiologyWorkflow(
        order.id,
        next,
      );

      await load();
    } catch (err) {
      console.error(
        'Unable to update RIS workflow:',
        err,
      );

      setError(
        'Unable to update radiology workflow status.',
      );
    } finally {
      setUpdatingOrderId(null);
    }
  }

  async function changeAssignment(
    order: RisRadiologyOrder,
    practitionerId: string,
  ) {
    if (!order.id || !hospitalId) {
      return;
    }

    try {
      setAssigningOrderId(order.id);
      setError('');

      if (practitionerId) {
        await assignRadiologist(
          order.id,
          hospitalId,
          practitionerId,
        );
      } else {
        await unassignRadiologist(
          order.id,
          hospitalId,
        );
      }

      await load();
    } catch (err) {
      console.error(
        'Unable to update radiologist assignment:',
        err,
      );

      setError(
        'Unable to update the assigned radiologist.',
      );
    } finally {
      setAssigningOrderId(null);
    }
  }

  async function viewImages(
    order: RisRadiologyOrder,
  ) {
    if (!order.id) {
      return;
    }

    try {
      setOpeningImagesId(order.id);
      setError('');

      const response =
        await getImagingStudiesByOrder(
          order.id,
        );

      const study = response.studies.find(
        (item) =>
          Boolean(item.studyInstanceUid),
      );

      if (!study?.studyInstanceUid) {
        setError(
          `No PACS images are linked to accession ${
            order.accessionNumber ||
            order.id
          }.`,
        );
        return;
      }

      openOhifStudy(
        study.studyInstanceUid,
      );
    } catch (err) {
      console.error(
        'Unable to open PACS images:',
        err,
      );

      setError(
        'Unable to locate the linked ImagingStudy in PACS.',
      );
    } finally {
      setOpeningImagesId(null);
    }
  }

  return (
    <main className="ris-root">
      <section className="ris-hero">
        <div>
          <div className="ris-kicker">
            <Activity size={15} />
            RADIOLOGY INFORMATION SYSTEM
          </div>

          <h1>Radiology Worklist</h1>

          <p>
            Central imaging workflow from
            order arrival through PACS,
            reporting and finalization.
          </p>
        </div>

        <div className="ris-hero-actions">
          {hospitalId && (
            <span className="ris-hospital">
              <MapPin size={15} />
              Hospital
              <strong>{hospitalId}</strong>
            </span>
          )}

          <label className="ris-reporting-as">
            <UserRound size={15} />
            <span>Reporting as</span>
            <select
              value={currentRadiologistId}
              onChange={(event) =>
                changeCurrentRadiologist(
                  event.target.value,
                )
              }
            >
              <option value="">
                Select radiologist
              </option>
              {radiologists.map((item) => (
                <option
                  key={item.practitionerId}
                  value={item.practitionerId}
                >
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="ris-refresh"
            onClick={() => void load()}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </section>

      {error && (
        <div className="ris-alert">
          <AlertTriangle size={17} />
          {error}
        </div>
      )}

      <section className="ris-stats">
        <Stat
          icon={<Image size={18} />}
          label="Total Studies"
          value={data.summary.total}
        />

        <Stat
          icon={<Clock3 size={18} />}
          label="Active"
          value={data.summary.active}
          tone="blue"
        />

        <Stat
          icon={<ShieldAlert size={18} />}
          label="Urgent / STAT"
          value={data.summary.urgent}
          tone={
            data.summary.urgent
              ? 'red'
              : 'default'
          }
        />

        <Stat
          icon={<ExternalLink size={18} />}
          label="Images Available"
          value={data.summary.imagesAvailable}
          tone="violet"
        />

        <Stat
          icon={<Stethoscope size={18} />}
          label="Reporting"
          value={data.summary.reporting}
          tone="amber"
        />

        <Stat
          icon={<CheckCircle2 size={18} />}
          label="Final"
          value={data.summary.final}
          tone="green"
        />
      </section>

      <section className="ris-toolbar">
        <label className="ris-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) =>
              setQuery(event.target.value)
            }
            placeholder="Search patient, accession, exam, requester, radiologist..."
          />
        </label>

        <select
          value={modality}
          onChange={(event) =>
            setModality(event.target.value)
          }
        >
          <option value="all">
            All Modalities
          </option>

          {orderedModalities.map((item) => (
            <option
              key={item}
              value={item}
            >
              {item}
            </option>
          ))}

          {orderedModalities.length === 0 && (
            <>
              <option value="XR">XR</option>
              <option value="CT">CT</option>
              <option value="MR">MR</option>
              <option value="US">US</option>
            </>
          )}
        </select>

        <select
          value={priority}
          onChange={(event) =>
            setPriority(event.target.value)
          }
        >
          <option value="all">
            All Priorities
          </option>
          <option value="routine">
            Routine
          </option>
          <option value="urgent">
            Urgent
          </option>
          <option value="asap">ASAP</option>
          <option value="stat">STAT</option>
        </select>
      </section>

      <section className="ris-assignment-tabs">
        <button
          type="button"
          className={
            assignmentView === 'all'
              ? 'active'
              : ''
          }
          onClick={() =>
            setAssignmentView('all')
          }
        >
          <UserRoundCheck size={15} />
          All Studies
        </button>

        <button
          type="button"
          className={
            assignmentView === 'unassigned'
              ? 'active'
              : ''
          }
          onClick={() =>
            setAssignmentView('unassigned')
          }
        >
          <UserRoundX size={15} />
          Unassigned
        </button>

        <button
          type="button"
          disabled={!currentRadiologistId}
          className={
            assignmentView === 'mine'
              ? 'active'
              : ''
          }
          onClick={() =>
            setAssignmentView('mine')
          }
          title={
            currentRadiologist
              ? `Studies assigned to ${currentRadiologist.displayName}`
              : 'Select a radiologist first'
          }
        >
          <UserRound size={15} />
          My Studies
        </button>

        <span className="ris-assignment-summary">
          Assigned {data.summary.assigned} · Unassigned{' '}
          {data.summary.unassigned}
        </span>
      </section>

      <section className="ris-workflow-tabs">
        {(
          [
            ['all', 'All'],
            ['ordered', 'Ordered'],
            ['scheduled', 'Scheduled'],
            ['arrived', 'Arrived'],
            ['exam-started', 'In Progress'],
            ['acquired', 'Acquired / PACS'],
            ['preliminary', 'Preliminary'],
            ['reporting', 'Reporting'],
            ['final', 'Final'],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={
              workflowFilter === value
                ? 'active'
                : ''
            }
            onClick={() =>
              setWorkflowFilter(value)
            }
          >
            {label}
          </button>
        ))}
      </section>

      {loading ? (
        <section className="ris-state">
          <Loader2
            size={30}
            className="ris-spin"
          />
          <strong>
            Loading RIS worklist
          </strong>
        </section>
      ) : data.orders.length === 0 ? (
        <section className="ris-state">
          <Image size={34} />
          <strong>
            No radiology orders found
          </strong>
          <span>
            No studies match the selected
            worklist filters.
          </span>
        </section>
      ) : (
        <section className="ris-table-shell">
          <div className="ris-table-head">
            <span>Patient / Accession</span>
            <span>Examination</span>
            <span>Priority</span>
            <span>Workflow</span>
            <span>Assigned Radiologist</span>
            <span>Ordered</span>
            <span>Actions</span>
          </div>

          <div className="ris-table-body">
            {data.orders.map((order) => (
              <WorklistRow
                key={order.id}
                order={order}
                radiologists={radiologists}
                updating={
                  updatingOrderId === order.id
                }
                assigning={
                  assigningOrderId === order.id
                }
                openingImages={
                  openingImagesId === order.id
                }
                onWorkflow={changeWorkflow}
                onAssignment={changeAssignment}
                onImages={viewImages}
                onReport={setReportOrder}
              />
            ))}
          </div>
        </section>
      )}

      <footer className="ris-footer">
        Showing {data.returned} of{' '}
        {data.total} studies
      </footer>

      {reportOrder &&
        reportOrder.patientId &&
        reportOrder.encounterId &&
        hospitalId && (
          <RadiologyReport
            order={reportOrder}
            patientId={reportOrder.patientId}
            encounterId={reportOrder.encounterId}
            hospitalId={hospitalId}
            practitionerId={
              reportOrder.radiologistId
            }
            practitionerName={
              reportOrder.radiologistName
            }
            onClose={() =>
              setReportOrder(null)
            }
            onChanged={() => void load()}
          />
        )}
    </main>
  );
}

function WorklistRow({
  order,
  radiologists,
  updating,
  assigning,
  openingImages,
  onWorkflow,
  onAssignment,
  onImages,
  onReport,
}: {
  order: RisRadiologyOrder;
  radiologists: RadiologistDirectoryItem[];
  updating: boolean;
  assigning: boolean;
  openingImages: boolean;
  onWorkflow: (
    order: RisRadiologyOrder,
    next: RadiologyWorkflowStatus,
  ) => Promise<void>;
  onAssignment: (
    order: RisRadiologyOrder,
    practitionerId: string,
  ) => Promise<void>;
  onImages: (
    order: RisRadiologyOrder,
  ) => Promise<void>;
  onReport: (
    order: RisRadiologyOrder,
  ) => void;
}) {
  const workflow =
    order.workflowStatus || 'ordered';

  const imageReady =
    WORKFLOW_STEPS.indexOf(workflow) >=
    WORKFLOW_STEPS.indexOf(
      'acquired',
    );

  const assignedIsActive = radiologists.some(
    (item) =>
      item.practitionerId ===
      order.radiologistId,
  );

  return (
    <article className="ris-row">
      <div className="ris-patient-cell">
        <strong>
          {order.patientName || 'Patient'}
        </strong>
        <span>
          {order.accessionNumber || order.id}
        </span>
        <small>{order.patientId}</small>
      </div>

      <div className="ris-exam-cell">
        <span
          className={`ris-modality ris-mod-${String(
            order.modality,
          ).toLowerCase()}`}
        >
          {order.modality}
        </span>

        <div>
          <strong>{order.examName}</strong>
          <span>
            {order.bodySiteName ||
              order.examCode ||
              '—'}
          </span>
        </div>
      </div>

      <div>
        <span
          className={`ris-priority ${order.priority}`}
        >
          {String(order.priority).toUpperCase()}
        </span>
      </div>

      <div>
        <span
          className={`ris-workflow status-${workflow}`}
        >
          {formatWorkflow(workflow)}
        </span>
      </div>

      <div className="ris-assignee-cell">
        {assigning ? (
          <span className="ris-assignee-loading">
            <Loader2
              size={15}
              className="ris-spin"
            />
            Saving
          </span>
        ) : (
          <>
            <select
              value={order.radiologistId ?? ''}
              onChange={(event) =>
                void onAssignment(
                  order,
                  event.target.value,
                )
              }
            >
              <option value="">
                Unassigned
              </option>

              {order.radiologistId &&
                !assignedIsActive && (
                  <option
                    value={order.radiologistId}
                  >
                    {order.radiologistName ||
                      'Assigned radiologist'}
                  </option>
                )}

              {radiologists.map((item) => (
                <option
                  key={item.practitionerId}
                  value={item.practitionerId}
                >
                  {item.displayName}
                </option>
              ))}
            </select>

            <small>
              {order.radiologistName
                ? order.assignedAt
                  ? `Assigned ${formatDateTime(
                      order.assignedAt,
                    )}`
                  : 'Assigned'
                : 'Awaiting assignment'}
            </small>
          </>
        )}
      </div>

      <div className="ris-date-cell">
        <CalendarClock size={15} />
        {formatDateTime(order.authoredOn)}
      </div>

      <div className="ris-actions">
        {updating ? (
          <Loader2
            size={18}
            className="ris-spin"
          />
        ) : (
          <>
            {workflow === 'scheduled' && (
              <button
                type="button"
                onClick={() =>
                  void onWorkflow(
                    order,
                    'arrived',
                  )
                }
              >
                Arrived
              </button>
            )}

            {(
              workflow === 'ordered' ||
              workflow === 'arrived'
            ) && (
              <button
                type="button"
                onClick={() =>
                  void onWorkflow(
                    order,
                    workflow === 'ordered'
                      ? 'scheduled'
                      : 'exam-started',
                  )
                }
              >
                {workflow === 'ordered'
                  ? 'Schedule'
                  : 'Start Exam'}
              </button>
            )}
          </>
        )}

        <button
          type="button"
          className="images"
          disabled={
            !imageReady || openingImages
          }
          onClick={() => void onImages(order)}
        >
          {openingImages ? (
            <Loader2
              size={15}
              className="ris-spin"
            />
          ) : (
            <ExternalLink size={15} />
          )}
          View Images
        </button>

        <button
          type="button"
          className="report"
          disabled={
            !order.patientId ||
            !order.encounterId ||
            !order.radiologistId
          }
          title={
            order.radiologistId
              ? 'Open radiologist report'
              : 'Assign a radiologist before reporting'
          }
          onClick={() => onReport(order)}
        >
          <FileText size={15} />
          Report
        </button>
      </div>
    </article>
  );
}

function Stat({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?:
    | 'default'
    | 'blue'
    | 'red'
    | 'green'
    | 'violet'
    | 'amber';
}) {
  return (
    <div className={`ris-stat ${tone}`}>
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatWorkflow(
  value: RadiologyWorkflowStatus,
) {
  return value
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase(),
    );
}

function formatDateTime(
  value?: string,
) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString();
}
