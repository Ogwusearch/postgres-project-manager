import { randomUUID } from "node:crypto";
import type { SqlExecutor } from "@postgres-project-manager/postgres-admin";

export type AuditOutcome = "succeeded" | "failed";

export interface CreateAuditEventInput {
  actor: string;
  action: string;
  target: string;
  outcome: AuditOutcome;
  details: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  outcome: AuditOutcome;
  details: Record<string, unknown>;
  created_at: Date;
}

export function createAuditEventRepository(executor: SqlExecutor) {
  return {
    async create(input: CreateAuditEventInput): Promise<{ id: string }> {
      const result = await executor.query<{ id: string }>(
        `INSERT INTO public.audit_events
          (id, actor, action, target, outcome, details)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          randomUUID(),
          input.actor,
          input.action,
          input.target,
          input.outcome,
          input.details,
        ],
      );

      return result.rows[0]!;
    },
  };
}
