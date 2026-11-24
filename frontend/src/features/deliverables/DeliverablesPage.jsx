import { useCallback, useMemo } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import Button from '@mui/material/Button';
import { usersApi } from '../../api/resources';
import { useAuth } from '../../auth/AuthContext';
import PageHeader from '../../components/PageHeader';
import useApi from '../../hooks/useApi';
import DeliverablesView from './DeliverablesView';

/**
 * Every deliverable the user can see, across projects. `?person=<id>` (from search, capacity, teams) narrows it
 * to one person's work; that is separate from the "Mine" quick filter, which stays switchable.
 */
export default function DeliverablesPage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const personId = params.get('person');
  const baseQuery = useMemo(() => (personId ? { owner_id: personId } : {}), [personId]);
  const loadPerson = useCallback((signal) => (personId ? usersApi.get(personId, signal) : Promise.resolve(null)), [personId]);
  const { data: person } = useApi(loadPerson);

  return (
    <>
      <PageHeader
        title={personId ? `Deliverables · ${person?.name ?? '…'}` : 'Deliverables'}
        subtitle={personId ? 'Everything assigned to this person, across the projects you can see.' : 'Key deliverables across all projects you can see, with their status and due dates.'}
        actions={personId && <Button component={RouterLink} to="/deliverables" variant="outlined">All deliverables</Button>}
      />
      <DeliverablesView baseQuery={baseQuery} showProject canCreate={can('deliverables', 'create')} />
    </>
  );
}
