import { useState } from 'react';
import PropTypes from 'prop-types';
import Chip from '@mui/material/Chip';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CheckIcon from '@mui/icons-material/Check';
import { deliverablesApi } from '../../api/resources';
import { useNotify } from '../../components/NotificationProvider';
import StatusChip from '../../components/StatusChip';
import { useMeta } from '../../meta/MetaContext';
import { canSetStatus } from './canSetStatus';
import { labelize } from '../../utils/format';
import { STATUS_COLORS } from '../../utils/statusColors';
import { tonal } from '../../utils/tonal';

/**
 * A deliverable's status that can be changed where it is shown: click it and pick the new status.
 * People who may not change it see a plain chip. The API's rules still decide (for example, blocked
 * work cannot be started), and its message is shown when it refuses.
 */
export default function StatusMenu({ item, onChanged }) {
  const notify = useNotify();
  const { meta } = useMeta();
  const [anchor, setAnchor] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!canSetStatus(item)) return <StatusChip value={item.status} />;

  const choose = async (status) => {
    setAnchor(null);
    if (status === item.status) return;
    setBusy(true);
    try {
      const updated = await deliverablesApi.update(item.id, { status });
      notify(`${item.key} is now ${labelize(updated.status).toLowerCase()}`);
      onChanged?.(updated);
    } catch (err) {
      notify(err.details?.status ? `${item.key}: ${err.details.status}` : err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
      <Chip
        size="small"
        label={labelize(item.status)}
        disabled={busy}
        onClick={(e) => setAnchor(e.currentTarget)}
        onDelete={(e) => setAnchor(e.currentTarget.closest('.MuiChip-root'))}
        deleteIcon={<ArrowDropDownIcon aria-hidden />}
        aria-label={`Status of ${item.key}: ${labelize(item.status)}. Change`}
        aria-haspopup="menu"
        sx={[tonal(STATUS_COLORS[item.status] || 'default'), { '& .MuiChip-deleteIcon': { color: 'inherit', opacity: 0.7, mr: 0.25 } }]}
      />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {(meta?.deliverable_statuses || []).map(({ value }) => (
          <MenuItem key={value} selected={value === item.status} onClick={() => choose(value)}>
            <ListItemIcon>{value === item.status && <CheckIcon fontSize="small" />}</ListItemIcon>
            {labelize(value)}
          </MenuItem>
        ))}
      </Menu>
    </span>
  );
}

StatusMenu.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.number.isRequired, key: PropTypes.string.isRequired, status: PropTypes.string.isRequired, permissions: PropTypes.object,
  }).isRequired,
  /** Called with the updated record after a successful change. */
  onChanged: PropTypes.func,
};
