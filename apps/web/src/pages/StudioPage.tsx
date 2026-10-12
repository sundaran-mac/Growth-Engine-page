// Studio (Figma frame 241:990). `/studio` shows a picker; `/studio/:briefId` shows one brief.
import { useParams } from 'react-router-dom';
import { StudioPicker } from '@/features/make/studio/StudioPicker';
import { StudioView } from '@/features/make/studio/StudioView';

export default function StudioPage() {
  const { briefId } = useParams();
  return briefId ? <StudioView key={briefId} briefId={briefId} /> : <StudioPicker />;
}
