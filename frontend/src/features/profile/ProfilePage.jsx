import { useState } from 'react';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { updateMe } from '../../api/auth';
import { useAuth } from '../../auth/AuthContext';
import { setTokens } from '../../auth/tokenStore';
import FormDialog from '../../components/FormDialog';
import { useNotify } from '../../components/NotificationProvider';
import PageHeader from '../../components/PageHeader';
import StatusChip from '../../components/StatusChip';
import { useMeta } from '../../meta/MetaContext';

/** Own profile: name, password, and signing out of every device. */
export default function ProfilePage() {
  const { user, reload, logoutAll } = useAuth();
  const { meta } = useMeta();
  const notify = useNotify();
  const [dialog, setDialog] = useState(null);
  const minPassword = meta?.settings?.['auth.password_min_length'] || 8;

  return (
    <>
      <PageHeader title="Your profile" />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card><CardContent>
            <Stack spacing={1}>
              <Typography variant="h2">{user.name}</Typography>
              <Typography color="text.secondary">{user.email}</Typography>
              <div><StatusChip value={user.role} /></div>
              {user.job_title && <Typography>{user.job_title}</Typography>}
              <Typography variant="body2" color="text.secondary">Weekly capacity: {user.weekly_capacity_hours} hours</Typography>
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <Button variant="outlined" onClick={() => setDialog('name')}>Edit name</Button>
              <Button variant="outlined" onClick={() => setDialog('password')}>Change password</Button>
            </Stack>
          </CardContent></Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card><CardContent>
            <Typography variant="h3" gutterBottom>Sessions</Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>Signed in on a shared or lost device? Sign out everywhere, including here.</Typography>
            <Button color="error" variant="outlined" onClick={logoutAll}>Sign out everywhere</Button>
          </CardContent></Card>
        </Grid>
      </Grid>
      {dialog === 'name' && (
        <FormDialog open title="Edit name" fields={[{ name: 'name', label: 'Full name', required: true }]}
          initialValues={{ id: user.id, name: user.name }}
          onSubmit={async (values) => { await updateMe(values); await reload(); notify('Name updated'); }}
          onClose={() => setDialog(null)} />
      )}
      {dialog === 'password' && (
        <FormDialog open title="Change password" submitLabel="Change password"
          fields={[
            { name: 'current_password', label: 'Current password', type: 'password', required: true, autoComplete: 'current-password' },
            { name: 'password', label: 'New password', type: 'password', required: true, minLength: minPassword, autoComplete: 'new-password',
              helperText: 'Other devices will be signed out.' },
          ]}
          onSubmit={async (values) => {
            const result = await updateMe(values);
            if (result.tokens) setTokens(result.tokens);
            notify('Password changed');
          }}
          onClose={() => setDialog(null)} />
      )}
    </>
  );
}
