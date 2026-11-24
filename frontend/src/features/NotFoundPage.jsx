import { Link as RouterLink } from 'react-router-dom';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

/** Shown for unknown client-side routes. */
export default function NotFoundPage() {
  return (
    <Stack spacing={2} alignItems="flex-start">
      <Typography variant="h1">Page not found</Typography>
      <Typography color="text.secondary">The page you are looking for does not exist or has moved.</Typography>
      <Button variant="contained" component={RouterLink} to="/">Go to home</Button>
    </Stack>
  );
}
