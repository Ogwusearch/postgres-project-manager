import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

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

export function createAuditEventRepository(pool: Pool) {
  return {
    async create(input: CreateAuditEventInput): Promise<AuditEvent> {
      const result = await pool.query<AuditEvent>(
        `INSERT INTO public.audit_events
          (id, actor, action, target, outcome, details)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, actor, action, target, outcome, details, created_at`,
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
