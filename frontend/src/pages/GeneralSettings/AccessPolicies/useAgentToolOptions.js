import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Admin from "@/models/admin";
import AgentFlows from "@/models/agentFlows";
import MCPServers from "@/models/mcpServers";
import {
  getDefaultSkills,
  getConfigurableSkills,
  getAppIntegrationSkills,
} from "@/pages/Admin/Agents/skills.jsx";

/**
 * @typedef {Object} ToolOption
 * @property {string} value - The entry name the server stores (e.g. `web-browsing`, `@@flow_<uuid>`, `server:tool`).
 * @property {string} label - What the admin sees.
 * @property {string} group - Optgroup heading.
 */

/**
 * Lists every agent tool an admin can name in a policy rule: built-in skills, agent
 * flows, imported plugins, whole MCP servers and single MCP tools. Uses the same
 * endpoints as the agent skills settings page.
 * @returns {{options: ToolOption[], labelFor: (value: string) => string, loading: boolean}}
 */
export default function useAgentToolOptions() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [flows, setFlows] = useState([]);
  const [imported, setImported] = useState([]);
  const [mcpServers, setMcpServers] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [flowsRes, prefs, mcpRes] = await Promise.all([
        AgentFlows.listFlows(),
        Admin.systemPreferencesByFields(["imported_agent_skills"]),
        MCPServers.listServers(),
      ]);
      if (cancelled) return;
      setFlows(flowsRes?.flows || []);
      setImported(prefs?.settings?.imported_agent_skills || []);
      setMcpServers(mcpRes?.servers || []);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(() => {
    const builtIn = {
      ...getDefaultSkills(t),
      ...getConfigurableSkills(t),
      ...getAppIntegrationSkills(t),
    };
    const list = [
      { value: "*", label: "Everything (*)", group: "Special" },
      ...Object.values(builtIn).map((skill) => ({
        value: skill.skill,
        label: skill.title,
        group: "Built-in skills",
      })),
      ...flows.map((flow) => ({
        value: `@@flow_${flow.uuid}`,
        label: flow.name,
        group: "Agent flows",
      })),
      ...imported.map((plugin) => ({
        value: `@@${plugin.hubId}`,
        label: plugin.name || plugin.hubId,
        group: "Imported skills",
      })),
    ];
    for (const server of mcpServers) {
      list.push({
        value: `@@mcp_${server.name}`,
        label: `${server.name} (all tools)`,
        group: "MCP servers",
      });
      for (const tool of server.tools || []) {
        list.push({
          value: `${server.name}:${tool.name}`,
          label: `${server.name}: ${tool.name}`,
          group: "MCP tools",
        });
      }
    }
    return list;
  }, [t, flows, imported, mcpServers]);

  const labelFor = (value) =>
    options.find((opt) => opt.value === value)?.label || value;

  return { options, labelFor, loading };
}
