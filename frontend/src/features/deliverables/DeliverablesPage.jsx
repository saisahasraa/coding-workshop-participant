import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import PageHeader from '../../components/PageHeader';
import DeliverablesView from './DeliverablesView';

/**
 * Every deliverable the user can see, across projects. `?person=<id>` (from search) narrows it to one
 * person's work; that is separate from the "Mine" quick filter, which stays switchable.
 */
export default function DeliverablesPage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const ownerId = params.get('person');
  const baseQuery = useMemo(() => (ownerId ? { owner_id: ownerId } : {}), [ownerId]);
  return (
    <>
      <PageHeader
        title="Deliverables"
        subtitle={ownerId ? "One person's deliverables across the projects you can see." : 'Key deliverables across all projects you can see, with their status and due dates.'}
      />
      <DeliverablesView baseQuery={baseQuery} showProject canCreate={can('deliverables', 'create')} />
    </>
  );
}
