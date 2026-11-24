import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DEFAULT_APP_NAME } from '../config';
import { useAuth } from './AuthContext';

/** Email + password sign-in; returns the user to the page they originally requested. */
export default function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const target = location.state?.from?.pathname || '/';

  if (status === 'authenticated') return <Navigate to={target} replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!email.trim()) nextErrors.email = 'Enter your email';
    if (!password) nextErrors.password = 'Enter your password';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setBusy(true);
    setFailure(null);
    try {
      await login(email.trim(), password);
      navigate(target, { replace: true });
    } catch (err) {
      setFailure(err.message);
      setBusy(false);
    }
  };

  return (
    <Box component="main" sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, bgcolor: 'background.default' }}>
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h1" gutterBottom>{DEFAULT_APP_NAME}</Typography>
          <Typography
            sx={{
              color: "text.secondary",
              mb: 3
            }}>Sign in to continue</Typography>
          <form onSubmit={handleSubmit} noValidate>
            <Stack spacing={2}>
              {failure && <Alert severity="error">{failure}</Alert>}
              <TextField label="Email" type="email" autoComplete="username" autoFocus value={email}
                onChange={(e) => setEmail(e.target.value)} error={Boolean(errors.email)} helperText={errors.email} disabled={busy} required />
              <TextField label="Password" type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} error={Boolean(errors.password)} helperText={errors.password} disabled={busy} required />
              <Button type="submit" variant="contained" size="large" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
