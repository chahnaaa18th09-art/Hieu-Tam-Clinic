function escapeAdminMarkup(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function formatAdminDate(value) {
  if (!value) return '';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return year && month && day
    ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
      .format(new Date(year, month - 1, day))
    : String(value);
}

function adminAppointmentBadge(status) {
  const states = {
    pending: ['Chờ duyệt', 'badge-pending'],
    confirmed: ['Đã xác nhận', 'badge-confirmed'],
    rejected: ['Bị từ chối', 'badge-cancelled'],
    expired: ['Hết hạn', 'badge-cancelled'],
    cancelled: ['Đã hủy', 'badge-cancelled'],
    completed: ['Đã hoàn tất', 'badge-completed']
  };
  const [label, className] = states[status] || ['Không xác định', 'badge-pending'];
  return `<span class="status-badge ${className}">${label}</span>`;
}

function adminEmailDeliveryStatus(status) {
  const labels = {
    queued: 'Email đang chờ gửi',
    sending: 'Email đang được gửi',
    retry: 'Email lỗi, sẽ thử lại',
    sent: 'Email đã được máy chủ thư chấp nhận'
  };
  return labels[status] || '';
}

async function loadAdminDashboard() {
  try {
    const response = await apiRequest('/admin/stats');
    const data = response.data || {};
    const counts = data.counts || {};
    const holdPolicy = document.getElementById('adminHoldPolicy');
    if (holdPolicy) holdPolicy.textContent = `Yêu cầu Chờ duyệt giữ chỗ tối đa ${data.appointment_hold_minutes} phút kể từ lúc gửi.`;
    document.getElementById('statTotalAppt').textContent = counts.total_appointments ?? 0;
    document.getElementById('statTotalPatients').textContent = counts.patients ?? 0;
    document.getElementById('statPendingAppointments').textContent = counts.pending ?? 0;
    document.getElementById('statCancelledAppointments').textContent =
      (Number(counts.cancelled) || 0) + (Number(counts.rejected) || 0) + (Number(counts.expired) || 0);

    const tbody = document.getElementById('adminAppointmentsBody');
    if (tbody) {
      tbody.innerHTML = (data.recent_appointments || []).slice(0, 8).map(item => `
        <tr>
          <td><strong>${escapeAdminMarkup(item.appointment_code)}</strong></td>
          <td>${escapeAdminMarkup(item.patient_name)}</td>
          <td>${escapeAdminMarkup(item.doctor_display || item.doctor_name)}</td>
          <td>${escapeAdminMarkup(formatAdminDate(item.appointment_date))}</td>
          <td>${adminAppointmentBadge(item.status)}</td>
        </tr>
      `).join('') || '<tr><td colspan="5">Chưa có lịch hẹn.</td></tr>';
    }
  } catch (error) {
    const tbody = document.getElementById('adminAppointmentsBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5">${escapeAdminMarkup(error.message || 'Không thể tải dữ liệu.')}</td></tr>`;
    console.error('Không thể tải tổng quan quản trị:', error.message);
  }
}

async function loadAdminAppointments() {
  const tbody = document.getElementById('adminAppointmentsManagerBody');
  const status = document.getElementById('adminAppointmentsStatus');
  if (!tbody || !status) return;

  const statusFilter = document.getElementById('adminAppointmentStatusFilter').value;
  const search = document.getElementById('adminAppointmentSearch').value.trim();
  const params = new URLSearchParams();
  if (statusFilter !== 'all') params.set('status', statusFilter);
  if (search) params.set('search', search);
  status.textContent = 'Đang tải yêu cầu đặt lịch...';
  tbody.innerHTML = '';

  try {
    const response = await apiRequest(`/admin/appointments?${params.toString()}`);
    const appointments = Array.isArray(response.data) ? response.data : [];
    tbody.innerHTML = appointments.map(appointment => {
      const canReview = appointment.status === 'pending';
      const expiresAt = appointment.hold_expires_at
        ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
          .format(new Date(appointment.hold_expires_at))
        : '';
      return `
        <tr>
          <td><strong>${escapeAdminMarkup(appointment.appointment_code)}</strong></td>
          <td>${escapeAdminMarkup(appointment.patient_name)}<br>
            <small>${escapeAdminMarkup(appointment.patient_phone)} · ${escapeAdminMarkup(appointment.patient_email)}</small>
          </td>
          <td>${escapeAdminMarkup(appointment.doctor_display)}<br>
            <small>${escapeAdminMarkup(appointment.specialty_name)} · ${escapeAdminMarkup(appointment.room_number)}</small>
          </td>
          <td>${escapeAdminMarkup(formatAdminDate(appointment.appointment_date))}<br>
            <small>${escapeAdminMarkup(String(appointment.slot_time).slice(0, 5))}–${escapeAdminMarkup(String(appointment.end_time).slice(0, 5))}</small>
          </td>
          <td>${adminAppointmentBadge(appointment.status)}
            ${canReview ? `<small class="admin-hold-expiry">Giữ chỗ đến ${escapeAdminMarkup(expiresAt)}</small>` : ''}
            ${appointment.cancel_reason ? `<small class="admin-rejection-reason">${escapeAdminMarkup(appointment.cancel_reason)}</small>` : ''}
            ${appointment.email_delivery_status ? `<small class="admin-email-status">${escapeAdminMarkup(adminEmailDeliveryStatus(appointment.email_delivery_status))}</small>` : ''}
          </td>
          <td class="admin-appointment-actions">
            ${canReview ? `
              <button type="button" class="btn btn-primary admin-appointment-action" data-action="approve" data-id="${escapeAdminMarkup(appointment.id)}">Duyệt</button>
              <button type="button" class="btn btn-light-outline admin-appointment-action" data-action="reject" data-id="${escapeAdminMarkup(appointment.id)}">Từ chối</button>
            ` : '—'}
          </td>
        </tr>
      `;
    }).join('');
    status.textContent = appointments.length ? `Có ${appointments.length} lịch hẹn.` : 'Không có lịch hẹn ở trạng thái này.';
  } catch (error) {
    status.textContent = error.message || 'Không thể tải yêu cầu đặt lịch.';
    status.setAttribute('role', 'alert');
    console.error('Không thể tải danh sách lịch hẹn quản trị:', error.message);
  }
}

async function reviewAdminAppointment(id, action) {
  const payload = action === 'approve'
    ? { status: 'confirmed' }
    : { status: 'rejected', reason: window.prompt('Nhập lý do từ chối yêu cầu:')?.trim() || '' };
  if (action === 'approve' && !window.confirm('Xác nhận lịch hẹn này?')) return;
  if (action === 'reject' && !payload.reason) return;

  const buttons = [...document.querySelectorAll(`.admin-appointment-action[data-id="${CSS.escape(String(id))}"]`)];
  buttons.forEach(button => { button.disabled = true; });
  const status = document.getElementById('adminAppointmentsStatus');
  status.textContent = action === 'approve' ? 'Đang kiểm tra và xác nhận...' : 'Đang từ chối yêu cầu...';
  try {
    const response = await apiRequest(`/admin/appointments/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    status.textContent = response.message || 'Đã cập nhật trạng thái.';
  } catch (error) {
    status.textContent = error.message || 'Không thể xử lý yêu cầu.';
    status.setAttribute('role', 'alert');
  } finally {
    await loadAdminAppointments();
    await loadAdminDashboard();
  }
}

function switchAdminTab(tab, el) {
  document.querySelectorAll('.admin-sidebar .sidebar-menu a').forEach(link => link.classList.remove('active'));
  if (el) el.classList.add('active');
  const titles = {
    dashboard: 'Tổng quan',
    appointments: 'Quản lý lịch hẹn',
    doctors: 'Quản lý bác sĩ',
    specialties: 'Quản lý chuyên khoa',
    users: 'Quản lý người dùng & bệnh nhân',
    schedules: 'Quản lý lịch trực',
    settings: 'Cài đặt hệ thống'
  };
  document.getElementById('adminPageTitle').textContent = titles[tab] || 'Tổng quan';
  const isAppointments = tab === 'appointments';
  document.getElementById('adminDashboardContent').hidden = isAppointments;
  document.getElementById('adminAppointmentsPanel').hidden = !isAppointments;
  if (isAppointments) loadAdminAppointments();
}

function initAdminDashboard() {
  loadAdminDashboard();
  document.getElementById('adminAppointmentsRefresh')?.addEventListener('click', loadAdminAppointments);
  document.getElementById('adminAppointmentStatusFilter')?.addEventListener('change', loadAdminAppointments);
  document.getElementById('adminAppointmentSearch')?.addEventListener('input', () => {
    window.clearTimeout(window.adminAppointmentSearchTimer);
    window.adminAppointmentSearchTimer = window.setTimeout(loadAdminAppointments, 250);
  });
  document.getElementById('adminAppointmentsManagerBody')?.addEventListener('click', event => {
    const button = event.target.closest('.admin-appointment-action');
    if (button) reviewAdminAppointment(button.dataset.id, button.dataset.action);
  });
  window.setInterval(() => {
    if (!document.getElementById('adminAppointmentsPanel')?.hidden) loadAdminAppointments();
  }, 30 * 1000);
}

document.addEventListener('DOMContentLoaded', initAdminDashboard);
