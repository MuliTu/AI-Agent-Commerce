import { isProviderConfigured, parseEnvironment } from '@/lib/config/environment';
import { CommerceExperience } from './components/CommerceExperience';

export default function HomePage() {
  let environment;
  let configurationError = '';
  try {
    environment = parseEnvironment(process.env);
  } catch {
    environment = parseEnvironment({ LLM_PROVIDER: 'disabled' });
    configurationError = 'Product search is unavailable right now. Please try again later.';
  }
  return <CommerceExperience
    providerEnabled={isProviderConfigured(environment)}
    configurationError={configurationError}
  />;
}
