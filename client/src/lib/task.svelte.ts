/**
 * A form's submit (or any action that runs one at a time): whether it's running, and the message
 * to show after it, an error or `success`. Use with <TaskMessage>.
 */
export class Task {
  pending = $state(false);
  error = $state<string | null>(null);
  success = $state<string | null>(null);

  /** Runs `action` unless it's already running. Returns whether it worked. */
  async run(action: () => Promise<unknown>, success: string | null = null): Promise<boolean> {
    if (this.pending) return false;
    this.pending = true;
    this.error = this.success = null;
    try {
      await action();
      this.success = success;
      return true;
    } catch (err) {
      this.error = (err as Error).message;
      return false;
    } finally {
      this.pending = false;
    }
  }

  /** Shows a problem found before sending anything (e.g. passwords that don't match). */
  fail(message: string) {
    this.error = message;
    this.success = null;
  }
}
