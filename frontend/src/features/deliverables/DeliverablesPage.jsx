import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import DeliverablesView from './DeliverablesView';

/** Every deliverable the user can see, across projects; `?owner_id=` narrows it to one person's work. */
export default function DeliverablesPage() {
  const [params] = useSearchParams();
  const ownerId = params.get('owner_id');
  const baseQuery = useMemo(() => (ownerId ? { owner_id: ownerId } : {}), [ownerId]);
  return (
    <>
      <PageHeader
        title="Deliverables"
        subtitle={ownerId ? "One person's deliverables across the projects you can see." : 'Key deliverables across all projects you can see, with their status and due dates.'}
      />
      <DeliverablesView baseQuery={baseQuery} showProject />
    </>
  );
}
