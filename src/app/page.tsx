import { parseEnvironment } from '@/lib/config/environment';
import { CommerceExperience } from './components/CommerceExperience';

export default function HomePage() {
  const environment = parseEnvironment(process.env);
  return <CommerceExperience provider={environment.AI_PROVIDER} />;
}
