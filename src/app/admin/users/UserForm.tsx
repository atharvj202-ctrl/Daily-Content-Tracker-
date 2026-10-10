import type { Role, User } from "@/lib/db/schema";
import { ROLE_LABELS } from "@/lib/permissions";

export function UserForm({
  action,
  user,
  roles,
  defaultRole,
  isNew,
  readOnly,
}: {
  action: (form: FormData) => Promise<void>;
  user?: User;
  roles: Role[];
  defaultRole: Role;
  isNew: boolean;
  readOnly: boolean;
}) {
  return (
    <form action={action}>
      {user && <input type="hidden" name="id" value={user.id} />}
      <fieldset disabled={readOnly}>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" name="name" type="text" required maxLength={120} defaultValue={user?.name} />
          </div>
          <div className="field">
            <label htmlFor="email">
              Work email <span className="hint">used to sign in</span>
            </label>
            <input id="email" name="email" type="email" required defaultValue={user?.email} />
          </div>
          <div className="field">
            <label htmlFor="instagramHandle">
              Instagram handle <span className="hint">required for Agents / Managers</span>
            </label>
            <input id="instagramHandle" name="instagramHandle" type="text" placeholder="@name" defaultValue={user?.instagramHandle ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="instagramUrl">
              Instagram profile link <span className="hint">optional — built from the handle if blank</span>
            </label>
            <input id="instagramUrl" name="instagramUrl" type="url" placeholder="https://www.instagram.com/name/" defaultValue={user?.instagramUrl ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="role">Access role</label>
            <select id="role" name="role" defaultValue={user?.role ?? defaultRole}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="position">
              Position <span className="hint">e.g. Agent, Manager, Founder</span>
            </label>
            <input id="position" name="position" type="text" maxLength={60} defaultValue={user?.position ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="team">
              Team / manager <span className="hint">optional</span>
            </label>
            <input id="team" name="team" type="text" maxLength={80} defaultValue={user?.team ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="trackingStatus">Daily tracking</label>
            <select id="trackingStatus" name="trackingStatus" defaultValue={user?.trackingStatus ?? "tracked"}>
              <option value="tracked">Tracked on working days</option>
              <option value="exempt">Exception — not tracked (leave, etc.)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="trackingNote">
              Exception note <span className="hint">optional, e.g. “Annual leave until 20 Oct”</span>
            </label>
            <input id="trackingNote" name="trackingNote" type="text" maxLength={200} defaultValue={user?.trackingNote ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="trackingStartDate">
              Tracking starts on <span className="hint">defaults to the approval date</span>
            </label>
            <input id="trackingStartDate" name="trackingStartDate" type="date" defaultValue={user?.trackingStartDate ?? ""} />
          </div>
        </div>
        {isNew && (
          <div className="field">
            <label className="checkbox">
              <input type="checkbox" name="approve" defaultChecked /> Approve now (account is active and can sign in)
            </label>
          </div>
        )}
        {!readOnly && <button type="submit">{isNew ? "Add person" : "Save changes"}</button>}
      </fieldset>
    </form>
  );
}
