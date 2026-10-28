import { getProviderLabel, parseEnvironment } from '@/lib/config/environment';
import { CommerceExperience } from './components/CommerceExperience';

export default function HomePage() {
  const environment = parseEnvironment(process.env);
  return <CommerceExperience
    providerEnabled={environment.AI_PROVIDER !== 'disabled'}
    providerLabel={getProviderLabel(environment)}
  />;
}
