import { useState } from "react";
import { X } from "@phosphor-icons/react";
import Toggle from "@/components/lib/Toggle";

const SELECT_CLASS =
  "bg-zinc-800 light:bg-white light:border light:border-slate-300 text-white light:text-slate-700 text-sm rounded-[8px] outline-none block w-full h-8 px-3.5";
const INPUT_CLASS =
  "bg-zinc-800 light:bg-white light:border light:border-slate-300 text-white light:text-slate-700 placeholder:text-zinc-400 light:placeholder:text-slate-400 text-sm rounded-[8px] outline-none block w-full h-8 px-3.5";

/** Group options by their `group` field, keeping first-seen order. */
function groupOptions(options = []) {
  const groups = new Map();
  for (const opt of options) {
    if (!groups.has(opt.group)) groups.set(opt.group, []);
    groups.get(opt.group).push(opt);
  }
  return [...groups.entries()];
}

/**
 * A select listing installed tools by display name, with a free-text fallback for
 * entries that aren't installed yet.
 */
export function ToolSelect({
  toolOptions,
  value = "",
  onChange,
  exclude = [],
  placeholder = "Select a tool...",
  allowFreeText = true,
}) {
  const [freeText, setFreeText] = useState("");
  const available = toolOptions.options.filter(
    (opt) => !exclude.includes(opt.value)
  );

  return (
    <div className="flex flex-col gap-y-2 w-full">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
        disabled={toolOptions.loading}
      >
        <option value="">
          {toolOptions.loading ? "Loading tools..." : placeholder}
        </option>
        {groupOptions(available).map(([group, opts]) => (
          <optgroup key={group} label={group}>
            {opts.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {allowFreeText && (
        <div className="flex gap-x-2">
          <input
            type="text"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (!freeText.trim()) return;
              onChange(freeText.trim());
              setFreeText("");
            }}
            placeholder="Or type a tool name (e.g. server:tool)"
            className={INPUT_CLASS}
          />
          <button
            type="button"
            onClick={() => {
              if (!freeText.trim()) return;
              onChange(freeText.trim());
              setFreeText("");
            }}
            className="border-none shrink-0 h-8 px-3 rounded-[8px] text-sm bg-zinc-700 light:bg-slate-200 text-white light:text-slate-900 hover:opacity-80"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

/** A list of tool names shown as removable chips, with a picker to add more. */
export function ToolListPicker({
  label,
  hint,
  values = [],
  onChange,
  toolOptions,
}) {
  const add = (value) => {
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
  };
  const remove = (value) => onChange(values.filter((v) => v !== value));

  return (
    <div className="flex flex-col gap-y-1.5">
      {label && (
        <p className="text-sm font-medium leading-5 text-white light:text-slate-950">
          {label}
        </p>
      )}
      {hint && (
        <p className="text-xs leading-4 text-zinc-400 light:text-slate-600">
          {hint}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {values.length === 0 && (
          <span className="text-xs text-zinc-500 light:text-slate-500 italic">
            None
          </span>
        )}
        {values.map((value) => (
          <span
            key={value}
            title={value}
            className="flex items-center gap-x-1 px-2 py-1 rounded-md text-xs bg-zinc-800 light:bg-slate-100 text-white light:text-slate-900"
          >
            {toolOptions.labelFor(value)}
            <button
              type="button"
              aria-label={`Remove ${toolOptions.labelFor(value)}`}
              onClick={() => remove(value)}
              className="border-none text-zinc-400 hover:text-red-400"
            >
              <X size={12} weight="bold" />
            </button>
          </span>
        ))}
      </div>
      <ToolSelect
        toolOptions={toolOptions}
        exclude={values}
        placeholder="Add a tool..."
        onChange={add}
      />
    </div>
  );
}

/**
 * Edits a tool rule `{ allow: string[]|null, deny: string[] }`, or `null` for no
 * restriction.
 * @param {{rule: {allow: string[]|null, deny: string[]}|null, onChange: Function, toolOptions: object, restrictLabel?: string}} props
 */
export default function ToolRuleEditor({
  rule,
  onChange,
  toolOptions,
  restrictLabel = "Restrict agent tools",
  restrictDescription = "When off, every tool the system offers is available.",
}) {
  const restricted = !!rule;
  const allowAll = restricted && rule.allow === null;

  return (
    <div className="flex flex-col gap-y-4">
      <Toggle
        size="md"
        variant="horizontal"
        label={restrictLabel}
        description={restrictDescription}
        enabled={restricted}
        onChange={(checked) =>
          onChange(checked ? { allow: null, deny: [] } : null)
        }
      />
      {restricted && (
        <div className="flex flex-col gap-y-4 pl-4 border-l border-white/10 light:border-slate-300">
          <Toggle
            size="sm"
            variant="horizontal"
            label="All tools except the denied ones"
            description="When off, only the tools you list under Allowed can be used."
            enabled={allowAll}
            onChange={(checked) =>
              onChange({ ...rule, allow: checked ? null : [] })
            }
          />
          {!allowAll && (
            <ToolListPicker
              label="Allowed tools"
              values={rule.allow || []}
              onChange={(allow) => onChange({ ...rule, allow })}
              toolOptions={toolOptions}
            />
          )}
          <ToolListPicker
            label="Denied tools"
            hint="Denied tools win over allowed ones."
            values={rule.deny || []}
            onChange={(deny) => onChange({ ...rule, deny })}
            toolOptions={toolOptions}
          />
        </div>
      )}
    </div>
  );
}
