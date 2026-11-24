import PageHeader from '../../components/PageHeader';
import DeliverablesView from './DeliverablesView';

const MINE = { owner_id: 'me' };

/** Deliverables owned by the signed-in user. */
export default function MyWorkPage() {
  return (
    <>
      <PageHeader title="My work" subtitle="Deliverables you own. Update their status and progress as you go." />
      <DeliverablesView baseQuery={MINE} showProject />
    </>
  );
}
