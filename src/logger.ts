import { promises as fs } from 'fs';
import { join } from 'path';

export interface LogEntry {
  timestamp: string;
  endpoint: string;
  payload: any;
  response: any;
  return_code: number;
}

export interface Tool {
  name: string;
  service?: string;
}

export class ToolLogger {
  private logDir: string;

  constructor(logDir: string = 'logs') {
    this.logDir = logDir;
    this.ensureLogDir();
  }

  private async ensureLogDir(): Promise<void> {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }

  async logToolAccess(
    tool: Tool,
    endpoint: string,
    payload: any,
    response: any,
    returnCode: number
  ): Promise<void> {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      endpoint,
      payload,
      response,
      return_code: returnCode
    };

    const logFile = join(this.logDir, `${tool.name}.jsonl`);

    try {
      await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error(`Failed to write to log file ${logFile}:`, error);
    }
  }
}
