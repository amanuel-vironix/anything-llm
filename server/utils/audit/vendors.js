/**
 * Outbound data inventory (PLAN-audit-logging-and-compliance.md section 5.3,
 * requirement R11, check K-14).
 *
 * Every provider class that sends user data to a vendor is listed here by
 * folder. `instrument()` wraps the methods that carry data (chat completion,
 * embedding, vector writes and searches, speech, images) so each call is
 * counted per vendor, channel and hour, without content. `flush()` writes one
 * `vendor.data_sent` row per group. A test fails if a provider folder has no
 * entry here, so a new provider can't send data uncounted.
 *
 * Wrapping happens on the class prototypes once at boot, so it needs no change
 * in the code that picks a provider. Refusing a vendor without a BAA in HIPAA
 * mode (main plan, compliance item 8) hooks into `beforeSend` once the BAA
 * register exists.
 */
const path = require("path");

const UTILS = path.resolve(__dirname, "..");

// Per folder: the kind of vendor and the methods that carry user data.
const FOLDERS = {
  AiProviders: {
    kind: "llm",
    methods: [
      "getChatCompletion",
      "streamGetChatCompletion",
      "embedTextInput",
      "embedChunks",
    ],
  },
  EmbeddingEngines: {
    kind: "embedder",
    methods: ["embedTextInput", "embedChunks"],
  },
  vectorDbProviders: {
    kind: "vector_db",
    methods: ["addDocumentToNamespace", "performSimilaritySearch"],
  },
  TextToSpeech: { kind: "text_to_speech", methods: ["ttsBuffer"] },
  SpeechToText: { kind: "speech_to_text", methods: ["transcribe"] },
  ImageGenerators: {
    kind: "image_generation",
    methods: ["generateImage", "editImage", "requestImage"],
  },
};

// Every provider subfolder, by folder. `local: true` means the data stays on
// infrastructure the operator runs (still counted, marked local).
// `skip` explains a subfolder that is not a vendor.
const PROVIDERS = {
  AiProviders: {
    anthropic: {},
    apipie: {},
    azureOpenAi: {},
    bedrock: {},
    cerebras: {},
    cohere: {},
    cometapi: {},
    deepseek: {},
    embeddedLemonade: { local: true },
    fireworksAi: {},
    foundry: { local: true },
    gemini: {},
    genericOpenAi: {},
    giteeai: {},
    groq: {},
    koboldCPP: { local: true },
    lemonade: { local: true },
    liteLLM: {},
    llmman: {},
    lmStudio: { local: true },
    localAi: { local: true },
    minimax: {},
    mistral: {},
    modelMap: { skip: "model context-window table, sends nothing" },
    modelRouter: { skip: "routes to another provider, which is counted" },
    moonshotAi: {},
    novita: {},
    nvidiaNim: {},
    ollama: { local: true },
    omlx: { local: true },
    openAi: {},
    openRouter: {},
    perplexity: {},
    ppio: {},
    privatemode: {},
    sambanova: {},
    textGenWebUI: { local: true },
    togetherAi: {},
    vertex: {},
    xai: {},
    zai: {},
  },
  EmbeddingEngines: {
    azureOpenAi: {},
    cohere: {},
    gemini: {},
    genericOpenAi: {},
    lemonade: { local: true },
    liteLLM: {},
    lmstudio: { local: true },
    localAi: { local: true },
    mistral: {},
    native: { local: true },
    ollama: { local: true },
    openAi: {},
    openRouter: {},
    voyageAi: {},
  },
  vectorDbProviders: {
    astra: {},
    chroma: {},
    chromacloud: {},
    lance: { local: true },
    milvus: {},
    pgvector: {},
    pinecone: {},
    qdrant: {},
    weaviate: {},
    zilliz: {},
  },
  TextToSpeech: {
    elevenLabs: {},
    kokoro: { local: true },
    openAi: {},
    openAiGeneric: {},
  },
  SpeechToText: {
    deepgram: {},
    groq: {},
    lemonade: { local: true },
    openAi: {},
    openAiGeneric: {},
  },
  ImageGenerators: {
    gemini: {},
    lemonade: { local: true },
    llmman: {},
    localAi: { local: true },
    ollama: { local: true },
    openAi: {},
    openRouter: {},
  },
};

// vendor|kind|channel|hour -> count
const counts = new Map();
const { AsyncLocalStorage } = require("async_hooks");

const WRAPPED = Symbol.for("anythingllm.audit.vendorWrapped");
const ORIGINAL = Symbol.for("anythingllm.audit.vendorOriginal");
let flushTimer = null;

function hourOf(date = new Date()) {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/**
 * Counts one outbound call. Exported for code that calls a vendor without a
 * provider class.
 * @param {string} vendor
 * @param {string} kind
 */
function noteSend(vendor, kind) {
  const ctx = require("./context").currentContext();
  const channel = ctx?.channel || "system";
  const key = `${vendor}|${kind}|${channel}|${hourOf()}`;
  counts.set(key, (counts.get(key) || 0) + 1);
  if (!flushTimer) {
    flushTimer = setTimeout(
      () => {
        flushTimer = null;
        flush().catch(() => {});
      },
      60 * 60 * 1000
    );
    flushTimer.unref?.();
  }
}

// A wrapped method that calls another wrapped method of the same vendor
// (embedTextInput -> embedChunks) counts once.
const inCall = new AsyncLocalStorage();

function wrapMethod(proto, method, vendor, kind) {
  const found = proto[method];
  if (typeof found !== "function") return false;
  const own = Object.prototype.hasOwnProperty.call(proto, method);
  // Already wrapped for this class. An inherited wrapper belongs to the parent
  // vendor (chromacloud extends chroma), so the subclass gets its own.
  if (own && found[WRAPPED]) return false;
  const original = found[ORIGINAL] || found;
  const wrapped = function (...args) {
    if (inCall.getStore() === vendor) return original.apply(this, args);
    noteSend(vendor, kind);
    return inCall.run(vendor, () => original.apply(this, args));
  };
  wrapped[WRAPPED] = true;
  wrapped[ORIGINAL] = original;
  Object.defineProperty(wrapped, "name", { value: original.name });
  proto[method] = wrapped;
  return true;
}

/**
 * Wraps every listed provider's data-carrying methods.
 * @returns {{wrapped: string[], failed: {provider: string, error: string}[]}}
 */
function instrument() {
  const wrapped = [];
  const failed = [];
  for (const [folder, providers] of Object.entries(PROVIDERS)) {
    const { kind, methods } = FOLDERS[folder];
    for (const [name, info] of Object.entries(providers)) {
      if (info.skip) continue;
      const vendor = `${folder === "vectorDbProviders" ? "vectordb" : kind}:${name}`;
      try {
        const mod = require(path.join(UTILS, folder, name));
        for (const exported of Object.values(mod)) {
          if (typeof exported !== "function" || !exported.prototype) continue;
          for (const method of methods)
            if (wrapMethod(exported.prototype, method, vendor, kind))
              wrapped.push(`${vendor}.${method}`);
        }
      } catch (e) {
        failed.push({ provider: `${folder}/${name}`, error: e.message });
      }
    }
  }
  return { wrapped, failed };
}

/**
 * Writes one `vendor.data_sent` row per vendor, kind, channel and hour.
 * @returns {Promise<number>} rows written
 */
async function flush() {
  if (counts.size === 0) return 0;
  const { audit } = require("./index");
  const entries = [...counts.entries()];
  counts.clear();
  let written = 0;
  for (const [key, count] of entries) {
    const [vendor, kind, channel, hour] = key.split("|");
    const ctx = audit.systemContext("system");
    ctx.channel = channel;
    await audit
      .record(
        {
          action: "vendor.data_sent",
          targetType: "vendor",
          targetId: vendor,
          metadata: { vendor, kind, count, hour },
        },
        { ctx }
      )
      .then(() => (written += 1))
      .catch(() => {});
  }
  return written;
}

/** @returns {{vendor: string, kind: string, local: boolean}[]} */
function inventory() {
  const out = [];
  for (const [folder, providers] of Object.entries(PROVIDERS))
    for (const [name, info] of Object.entries(providers))
      if (!info.skip)
        out.push({
          vendor: `${folder === "vectorDbProviders" ? "vectordb" : FOLDERS[folder].kind}:${name}`,
          kind: FOLDERS[folder].kind,
          local: !!info.local,
        });
  return out;
}

module.exports = {
  FOLDERS,
  PROVIDERS,
  instrument,
  flush,
  noteSend,
  inventory,
  _counts: counts,
};
