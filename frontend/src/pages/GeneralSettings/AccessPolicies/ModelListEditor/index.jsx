import { useEffect, useId, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import { AVAILABLE_LLM_PROVIDERS } from "@/pages/GeneralSettings/LLMPreference";
import System from "@/models/system";

// Providers that can't be a policy target (the router is chosen separately).
const EXCLUDED_PROVIDERS = ["anythingllm-router"];
export const POLICY_PROVIDERS = AVAILABLE_LLM_PROVIDERS.filter(
  (llm) => !EXCLUDED_PROVIDERS.includes(llm.value)
);

export function providerName(value) {
  return POLICY_PROVIDERS.find((llm) => llm.value === value)?.name || value;
}

const FIELD_CLASS =
  "bg-zinc-800 light:bg-white light:border light:border-slate-300 text-white light:text-slate-700 placeholder:text-zinc-400 light:placeholder:text-slate-400 text-sm rounded-[8px] outline-none block w-full h-8 px-3.5 disabled:opacity-50";

/**
 * One provider + model pair. The model field is free text with suggestions from the
 * provider's model list, so `*` (any model of the provider) can be typed.
 */
export function ProviderModelRow({
  provider = "",
  model = "",
  onChange,
  allowWildcard = true,
}) {
  const listId = useId();
  const [models, setModels] = useState([]);

  useEffect(() => {
    if (!provider) {
      setModels([]);
      return;
    }
    let cancelled = false;
    System.customModels(provider)
      .then(({ models: found = [] }) => {
        if (!cancelled) setModels(found || []);
      })
      .catch(() => !cancelled && setModels([]));
    return () => {
      cancelled = true;
    };
  }, [provider]);

  return (
    <div className="flex gap-x-3 w-full">
      <select
        value={provider}
        onChange={(e) => onChange({ provider: e.target.value, model: "" })}
        className={FIELD_CLASS}
      >
        <option value="">Select a provider</option>
        {POLICY_PROVIDERS.map((llm) => (
          <option key={llm.value} value={llm.value}>
            {llm.name}
          </option>
        ))}
      </select>
      <input
        type="text"
        list={listId}
        value={model}
        disabled={!provider}
        onChange={(e) => onChange({ provider, model: e.target.value })}
        placeholder={
          provider
            ? allowWildcard
              ? "Model name, or * for any model"
              : "Model name"
            : "Select a provider first"
        }
        className={FIELD_CLASS}
      />
      <datalist id={listId}>
        {allowWildcard && <option value="*">Any model</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name || m.id}
          </option>
        ))}
      </datalist>
    </div>
  );
}

/** Edits a list of `{provider, model}` rows. */
export default function ModelListEditor({ value = [], onChange }) {
  const update = (index, next) =>
    onChange(value.map((row, i) => (i === index ? next : row)));
  const remove = (index) => onChange(value.filter((_, i) => i !== index));
  const add = () => onChange([...value, { provider: "", model: "" }]);

  return (
    <div className="flex flex-col gap-y-2">
      {value.length === 0 && (
        <p className="text-xs text-amber-400 light:text-amber-600">
          No models are allowed. Users with this policy can't chat until you add
          one.
        </p>
      )}
      {value.map((row, index) => (
        <div key={index} className="flex items-center gap-x-2">
          <ProviderModelRow
            provider={row.provider}
            model={row.model}
            onChange={(next) => update(index, next)}
          />
          <button
            type="button"
            aria-label="Remove model"
            onClick={() => remove(index)}
            className="border-none text-zinc-400 light:text-slate-500 hover:text-red-400"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="border-none self-start flex items-center gap-x-1 text-sm text-blue-400 light:text-blue-600 hover:underline"
      >
        <Plus size={14} weight="bold" /> Add a model
      </button>
    </div>
  );
}
