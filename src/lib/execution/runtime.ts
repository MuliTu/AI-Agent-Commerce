import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runLiveOrchestration } from '../orchestration/live';
import { CommerceRepository } from '../persistence';
import { ConversationExecutionService } from './service';

const runtimeKey = '__bazakConversationExecutionService';

type RuntimeGlobal = typeof globalThis & {
  [runtimeKey]?: ConversationExecutionService;
};

export function getConversationExecutionService(): ConversationExecutionService {
  const runtime = globalThis as RuntimeGlobal;
  if (runtime[runtimeKey]) return runtime[runtimeKey];
  const databasePath = process.env.BAZAK_DATABASE_PATH?.trim()
    || join(process.cwd(), 'var', 'data', 'commerce.sqlite');
  mkdirSync(dirname(databasePath), { recursive: true });
  const service = new ConversationExecutionService(
    new CommerceRepository(databasePath),
    runLiveOrchestration,
  );
  service.recoverInterruptedWork();
  runtime[runtimeKey] = service;
  return service;
}
