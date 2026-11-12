document.addEventListener('DOMContentLoaded', async () => {
  const tbody = document.getElementById('doctorScheduleBody');
  if (!tbody) return;

  const localAppts = JSON.parse(localStorage.getItem('hieutam_appointments') || '[]');
  const defaultAppts = [
    { appointment_code: 'HT-20261027-001', patient_name: 'Nguyễn Văn A', phone: '0901234567', appointment_date: '27/10/2026', appointment_time: '09:00 - 09:30', notes: 'Khám tổng quát định kỳ', status: 'confirmed' },
    { appointment_code: 'HT-20261027-002', patient_name: 'Trần Thị B', phone: '0912345678', appointment_date: '27/10/2026', appointment_time: '09:30 - 10:00', notes: 'Đau đầu, mệt mỏi', status: 'pending' }
  ];

  let list = [...localAppts, ...defaultAppts];
  try {
    const res = await apiRequest('/doctors/appointments');
    if (Array.isArray(res) && res.length) list = res;
  } catch (e) {}

  tbody.innerHTML = list.map(item => `
    <tr>
      <td><strong>${item.appointment_code}</strong></td>
      <td>${item.patient_name}</td>
      <td>${item.phone || '0901234567'}</td>
      <td>${item.appointment_time || '08:00'} - ${item.appointment_date}</td>
      <td>${item.notes || 'Khám chuyên khoa'}</td>
      <td><span class="status-badge ${item.status === 'cancelled' ? 'badge-cancelled' : 'badge-confirmed'}">${item.status === 'cancelled' ? 'Đã hủy' : 'Đã xác nhận'}</span></td>
    </tr>
  `).join('');
});