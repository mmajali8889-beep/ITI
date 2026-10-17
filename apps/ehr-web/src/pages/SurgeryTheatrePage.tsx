import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  ClipboardCheck,
  Clock3,
  HeartPulse,
  Loader2,
  Plus,
  RefreshCw,
  Scissors,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import {
  createSurgeryCase,
  getSurgeryCases,
  transitionSurgery,
  type SurgeryCase,
  type SurgeryStage,
} from "../api/surgeryApi";
import { useParams } from "react-router-dom";
import "./SurgeryTheatrePage.css";
const FLOW: SurgeryStage[] = [
  "requested",
  "authorized",
  "scheduled",
  "pre-op-assessed",
  "anesthesia-assessed",
  "consented",
  "pre-op-check-complete",
  "in-or",
  "who-check-complete",
  "anesthesia-started",
  "procedure-in-progress",
  "procedure-completed",
  "pacu",
  "completed",
];
const LABEL: Record<string, string> = {
  requested: "Surgery request",
  authorized: "Pre-authorization",
  scheduled: "OR scheduling",
  "pre-op-assessed": "Pre-op assessment",
  "anesthesia-assessed": "Anesthesia assessment",
  consented: "Consent",
  "pre-op-check-complete": "Pre-op checklist",
  "in-or": "Patient in OR",
  "who-check-complete": "WHO safety checklist",
  "anesthesia-started": "Anesthesia",
  "procedure-in-progress": "Procedure",
  "procedure-completed": "Operative note",
  pacu: "Recovery / PACU",
  completed: "Final destination",
  cancelled: "Cancelled",
};
export default function SurgeryTheatrePage() {
  const { hospitalId } = useParams<{ hospitalId: string }>();
  const [cases, setCases] = useState<SurgeryCase[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<SurgeryCase>(),
    [showCreate, setShowCreate] = useState(false),
    [filter, setFilter] = useState("active");
  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    try {
      const list = await getSurgeryCases(hospitalId);
      setCases(list);
      setSelected(
        (current) => list.find((v) => v.id === current?.id) ?? list[0],
      );
    } catch {
      setError("Unable to load operating theatre cases.");
    } finally {
      setLoading(false);
    }
  }, [hospitalId]);
  useEffect(() => {
    void load();
  }, [load]);
  const visible = useMemo(
    () =>
      cases.filter((v) =>
        filter === "all" || filter === "completed"
          ? v.stage === filter
          : !["completed", "cancelled"].includes(v.stage),
      ),
    [cases, filter],
  );
  const today = cases.filter(
    (v) =>
      v.scheduledStart &&
      new Date(v.scheduledStart).toDateString() === new Date().toDateString(),
  ).length;
  return (
    <main className="surgery-page">
      <section className="surgery-hero">
        <div>
          <span>PERIOPERATIVE COMMAND CENTER</span>
          <h1>
            <Scissors />
            Surgery & Operating Theatre
          </h1>
          <p>
            Authorization, safety, procedure and recovery in one controlled
            workflow.
          </p>
        </div>
        <div>
          <button onClick={() => void load()}>
            <RefreshCw />
            Refresh
          </button>
          <button className="primary" onClick={() => setShowCreate(true)}>
            <Plus />
            Surgery request
          </button>
        </div>
      </section>
      {error && (
        <div className="surgery-error">
          <AlertTriangle />
          {error}
          <button onClick={() => setError("")}>
            <X />
          </button>
        </div>
      )}
      <section className="surgery-stats">
        <Stat
          icon={<Activity />}
          label="Active cases"
          value={
            cases.filter((v) => !["completed", "cancelled"].includes(v.stage))
              .length
          }
        />
        <Stat icon={<CalendarClock />} label="Scheduled today" value={today} />
        <Stat
          icon={<Scissors />}
          label="In theatre"
          value={
            cases.filter((v) =>
              [
                "in-or",
                "who-check-complete",
                "anesthesia-started",
                "procedure-in-progress",
              ].includes(v.stage),
            ).length
          }
        />
        <Stat
          icon={<HeartPulse />}
          label="PACU"
          value={cases.filter((v) => v.stage === "pacu").length}
        />
        <Stat
          icon={<BadgeCheck />}
          label="Completed"
          value={cases.filter((v) => v.stage === "completed").length}
        />
      </section>
      <section className="surgery-board">
        <header>
          <div>
            <strong>Operating theatre board</strong>
            <span>
              Mandatory safety gates are enforced by the workflow engine
            </span>
          </div>
          <div>
            {["active", "completed", "all"].map((v) => (
              <button
                className={filter === v ? "active" : ""}
                onClick={() => setFilter(v)}
                key={v}
              >
                {v}
              </button>
            ))}
          </div>
        </header>
        {loading ? (
          <div className="surgery-empty">
            <Loader2 className="spin" />
          </div>
        ) : !visible.length ? (
          <div className="surgery-empty">
            <Scissors />
            <h2>No matching surgical cases</h2>
          </div>
        ) : (
          <div className="surgery-grid">
            {visible.map((item) => (
              <article
                className={selected?.id === item.id ? "selected" : ""}
                key={item.id}
                onClick={() => setSelected(item)}
              >
                <header>
                  <span className={`stage-${item.stage}`}>
                    {LABEL[item.stage]}
                  </span>
                  <b>{item.caseNumber}</b>
                </header>
                <h2>{item.procedureName}</h2>
                <p>
                  <UserRound />
                  {item.patientName ?? `Patient ${item.patientId?.slice(0, 8)}`}
                </p>
                <dl>
                  <div>
                    <dt>Surgeon</dt>
                    <dd>{item.surgeonName}</dd>
                  </div>
                  <div>
                    <dt>Operating room</dt>
                    <dd>{item.operatingRoomName ?? "Not scheduled"}</dd>
                  </div>
                  <div>
                    <dt>Time</dt>
                    <dd>
                      {item.scheduledStart
                        ? new Date(item.scheduledStart).toLocaleString()
                        : "Pending"}
                    </dd>
                  </div>
                </dl>
                <div className="case-progress">
                  <i
                    style={{
                      width: `${Math.max(3, ((FLOW.indexOf(item.stage) + 1) / FLOW.length) * 100)}%`,
                    }}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {selected && (
        <CasePanel
          item={selected}
          hospitalId={hospitalId!}
          onClose={() => setSelected(undefined)}
          onSaved={load}
        />
      )}{" "}
      {showCreate && (
        <CreateCase
          hospitalId={hospitalId!}
          onClose={() => setShowCreate(false)}
          onSaved={async () => {
            setShowCreate(false);
            await load();
          }}
        />
      )}
    </main>
  );
}
function CasePanel({
  item,
  hospitalId,
  onClose,
  onSaved,
}: {
  item: SurgeryCase;
  hospitalId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const next = FLOW[FLOW.indexOf(item.stage) + 1];
  const [show, setShow] = useState(false),
    [actor, setActor] = useState("OR Coordinator"),
    [note, setNote] = useState(""),
    [auth, setAuth] = useState(""),
    [room, setRoom] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [destination, setDestination] = useState("ward"),
    [implants, setImplants] = useState(""),
    [medications, setMedications] = useState(""),
    [consumables, setConsumables] = useState(""),
    [complications, setComplications] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  async function advance(e: FormEvent) {
    e.preventDefault();
    if (!next) return;
    setSaving(true);
    try {
      const checklist = [
        "pre-op-assessed",
        "anesthesia-assessed",
        "pre-op-check-complete",
        "who-check-complete",
      ].includes(next)
        ? { confirmed: true, identityVerified: true }
        : undefined;
      await transitionSurgery(item.id, {
        hospitalId,
        stage: next,
        actorName: actor,
        note,
        authorizationNumber: auth || undefined,
        operatingRoomName: room || undefined,
        scheduledStart: start || undefined,
        scheduledEnd: end || undefined,
        consentType:
          next === "consented" ? "Procedure and anesthesia consent" : undefined,
        checklist,
        implants:
          next === "procedure-completed"
            ? implants.split(",").map((name) => name.trim()).filter(Boolean).map((name) => ({ name }))
            : undefined,
        medications:
          next === "procedure-completed"
            ? medications.split(",").map((value) => value.trim()).filter(Boolean)
            : undefined,
        consumables:
          next === "procedure-completed"
            ? consumables.split(",").map((value) => value.trim()).filter(Boolean)
            : undefined,
        complications:
          next === "procedure-completed"
            ? complications.split(",").map((value) => value.trim()).filter(Boolean)
            : undefined,
        destination: next === "completed" ? destination : undefined,
      });
      setShow(false);
      await onSaved();
    } catch (cause) {
      setError(
        (cause as { response?: { data?: { message?: string } } }).response?.data
          ?.message ?? "Unable to advance surgery case.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <aside className="case-panel">
      <header>
        <div>
          <small>{item.caseNumber}</small>
          <h2>{item.procedureName}</h2>
        </div>
        <button onClick={onClose}>
          <X />
        </button>
      </header>
      <p>{item.indication}</p>
      <section className="team">
        <h3>Surgical team</h3>
        <span>
          Surgeon <b>{item.surgeonName}</b>
        </span>
        <span>
          Assistant <b>{item.assistantName ?? "Not assigned"}</b>
        </span>
        <span>
          Anesthesiologist <b>{item.anesthesiologistName ?? "Not assigned"}</b>
        </span>
        <span>
          Nurses <b>{item.nurseNames?.join(", ") || "Not assigned"}</b>
        </span>
      </section>
      <section className="stage-list">
        {FLOW.map((stage, index) => {
          const done = index <= FLOW.indexOf(item.stage);
          return (
            <div
              className={stage === item.stage ? "current" : done ? "done" : ""}
              key={stage}
            >
              <span>{done ? <BadgeCheck /> : <Clock3 />}</span>
              <b>{LABEL[stage]}</b>
            </div>
          );
        })}
      </section>
      {next && !show && (
        <button className="advance" onClick={() => setShow(true)}>
          <ShieldCheck />
          Continue to {LABEL[next]}
        </button>
      )}
      {show && (
        <form className="transition-form" onSubmit={advance}>
          {error && <p>{error}</p>}
          <label>
            Responsible clinician
            <input
              required
              value={actor}
              onChange={(e) => setActor(e.target.value)}
            />
          </label>
          {next === "authorized" && (
            <label>
              Authorization number
              <input
                required
                value={auth}
                onChange={(e) => setAuth(e.target.value)}
              />
            </label>
          )}
          {next === "scheduled" && (
            <>
              <label>
                Operating room
                <input
                  required
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                />
              </label>
              <label>
                Start
                <input
                  required
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                End
                <input
                  required
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </>
          )}
          {next === "completed" && (
            <label>
              Destination
              <select
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="ward">Ward</option>
                <option value="icu">ICU</option>
                <option value="discharge">Discharge</option>
              </select>
            </label>
          )}
          {next === "procedure-completed" && (
            <>
              <label>Implants (comma separated)<textarea value={implants} onChange={(e) => setImplants(e.target.value)} /></label>
              <label>Medications used<textarea value={medications} onChange={(e) => setMedications(e.target.value)} /></label>
              <label>Consumables<textarea value={consumables} onChange={(e) => setConsumables(e.target.value)} /></label>
              <label>Complications — leave blank if none<textarea value={complications} onChange={(e) => setComplications(e.target.value)} /></label>
            </>
          )}
          <label>
            Clinical note
            <textarea required={next === "procedure-completed"} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <footer>
            <button type="button" onClick={() => setShow(false)}>
              Cancel
            </button>
            <button className="advance" disabled={saving}>
              {saving ? <Loader2 className="spin" /> : <ClipboardCheck />}
              Confirm {LABEL[next]}
            </button>
          </footer>
        </form>
      )}
    </aside>
  );
}
function CreateCase({
  hospitalId,
  onClose,
  onSaved,
}: {
  hospitalId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
      patientId: "",
      encounterId: "",
      patientName: "",
      procedureName: "",
      procedureCode: "",
      indication: "",
      surgeonName: "",
      assistantName: "",
      anesthesiologistName: "",
      nurses: "",
    }),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createSurgeryCase({
        ...form,
        hospitalId,
        nurseNames: form.nurses
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      });
      await onSaved();
    } catch (cause) {
      setError(
        (cause as { response?: { data?: { message?: string } } }).response?.data
          ?.message ?? "Unable to create surgery request.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="surgery-dialog">
      <form onSubmit={submit}>
        <header>
          <div>
            <small>NEW CASE</small>
            <h2>Surgery request</h2>
          </div>
          <button type="button" onClick={onClose}>
            <X />
          </button>
        </header>
        {error && <p className="dialog-error">{error}</p>}
        <div className="create-grid">
          {(
            [
              ["patientId", "Patient ID"],
              ["encounterId", "Encounter ID"],
              ["procedureName", "Procedure"],
              ["procedureCode", "Procedure code / SNOMED"],
              ["surgeonName", "Primary surgeon"],
              ["assistantName", "Assistant"],
              ["anesthesiologistName", "Anesthesiologist"],
              ["nurses", "OR nurses (comma separated)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              {[
                "patientId",
                "encounterId",
                "procedureName",
                "surgeonName",
              ].includes(key) && " *"}
              <input
                required={[
                  "patientId",
                  "encounterId",
                  "procedureName",
                  "surgeonName",
                ].includes(key)}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <label className="wide">
            Indication *
            <textarea
              required
              value={form.indication}
              onChange={(e) => setForm({ ...form, indication: e.target.value })}
            />
          </label>
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            {saving ? <Loader2 className="spin" /> : <Plus />}Create request
          </button>
        </footer>
      </form>
    </div>
  );
}
function Stat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <article>
      <span>{icon}</span>
      <div>
        <b>{value}</b>
        <small>{label}</small>
      </div>
    </article>
  );
}
