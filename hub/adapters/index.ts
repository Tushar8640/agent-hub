// Adapter registry. To add a new kind of agent: write a factory (see cli.ts) and register it here.
import claudeCode from './claude-code.js';
import antigravity from './antigravity.js';
import cli from './cli.js';
import { errorMessage } from '../util.js';
import type { AdapterFactory, Agent, AgentConfig } from '../types.js';

export const ADAPTERS: Record<string, AdapterFactory> = {
  'claude-code': claudeCode,
  antigravity,
  cli,
};

const unavailable = (problem: string) => ({
  available: false,
  problem,
  resumable: false,
  fullAccess: false,
  start: () => ({ abort() {}, done: Promise.resolve({ error: problem }) }),
});

export function buildAgents(configs: AgentConfig[]): Agent[] {
  return configs.map(cfg => {
    const meta = { id: cfg.id, name: cfg.name, type: cfg.type };
    const factory = ADAPTERS[cfg.type];
    if (!factory) return { ...meta, ...unavailable(`Unknown agent type "${cfg.type}". Known types: ${Object.keys(ADAPTERS).join(', ')}`) };
    try {
      const instance = factory(cfg);
      const agent = { ...meta };
      Object.defineProperties(agent, Object.getOwnPropertyDescriptors(instance));
      return agent as Agent;
    } catch (e) {
      return { ...meta, ...unavailable(`Could not set up this agent: ${errorMessage(e)}`) };
    }
  });
}
