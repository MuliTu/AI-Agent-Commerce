import { getProviderLabel, isProviderConfigured, parseEnvironment } from '@/lib/config/environment';
import { CommerceExperience } from './components/CommerceExperience';

export default function HomePage() {
  let environment;
  let configurationError = '';
  try {
    environment = parseEnvironment(process.env);
  } catch {
    environment = parseEnvironment({ LLM_PROVIDER: 'disabled' });
    configurationError = 'The model provider configuration is invalid. Check the server-only LLM settings.';
  }
  return <CommerceExperience
    providerEnabled={isProviderConfigured(environment)}
    providerLabel={getProviderLabel(environment)}
    configurationError={configurationError}
  />;
}
