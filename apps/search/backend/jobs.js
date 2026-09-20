import { randomUUID } from 'node:crypto';

export class SearchJobQueue {
  constructor({ run, maxPending = 12, ttlMs = 900000 } = {}) {
    if (typeof run !== 'function') throw new TypeError('run required');
    this.run = run;
    this.maxPending = maxPending;
    this.ttlMs = ttlMs;
    this.jobs = new Map();
    this.pending = [];
    this.active = false;
    this.closed = false;
  }
  prune() {
    for (const [id, job] of this.jobs) {
      if (job.finishedAt && Date.now() - job.finishedAt > this.ttlMs) this.jobs.delete(id);
    }
  }
  submit(input) {
    this.prune();
    if (this.closed || this.pending.length + Number(this.active) >= this.maxPending) return null;
    const job = { id: randomUUID(), status: 'queued', createdAt: Date.now(), finishedAt: 0, input, result: null };
    this.jobs.set(job.id, job);
    this.pending.push(job.id);
    setImmediate(() => void this.drain());
    return this.view(job);
  }
  view(job) {
    return {
      id: job.id,
      status: job.status,
      created_at: new Date(job.createdAt).toISOString(),
      ...(job.finishedAt ? { finished_at: new Date(job.finishedAt).toISOString() } : {}),
      ...(job.status === 'complete' ? { result: job.result } : {}),
      ...(job.status === 'error' ? { error: 'SEARCH_JOB_FAILED' } : {}),
    };
  }
  get(id) {
    this.prune();
    const job = this.jobs.get(id);
    return job ? this.view(job) : null;
  }
  async drain() {
    if (this.active || this.closed) return;
    this.active = true;
    try {
      while (this.pending.length && !this.closed) {
        const job = this.jobs.get(this.pending.shift());
        if (!job) continue;
        job.status = 'running';
        try {
          job.result = await this.run(job.input);
          job.status = 'complete';
        } catch {
          job.status = 'error';
        } finally {
          job.input = null;
          job.finishedAt = Date.now();
        }
      }
    } finally {
      this.active = false;
    }
  }
  close() {
    this.closed = true;
    this.pending.length = 0;
    this.jobs.clear();
  }
}
