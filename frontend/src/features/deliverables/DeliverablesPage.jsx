import PageHeader from '../../components/PageHeader';
import DeliverablesView from './DeliverablesView';

const ALL = {};

/** Every deliverable the user can see, across projects. */
export default function DeliverablesPage() {
  return (
    <>
      <PageHeader title="Deliverables" subtitle="Key deliverables across all projects you can see, with their status and due dates." />
      <DeliverablesView baseQuery={ALL} showProject />
    </>
  );
}
