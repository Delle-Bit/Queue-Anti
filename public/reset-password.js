const params = new URLSearchParams(window.location.search);
const resetToken = params.get('token');

if (!resetToken) {
    showInvalidView();
}

function showInvalidView() {
    document.getElementById('reset-form-view').style.display = 'none';
    document.getElementById('reset-success-view').style.display = 'none';
    document.getElementById('reset-invalid-view').style.display = 'block';
}

function showSuccessView() {
    document.getElementById('reset-form-view').style.display = 'none';
    document.getElementById('reset-invalid-view').style.display = 'none';
    document.getElementById('reset-success-view').style.display = 'block';
}

document.getElementById('reset-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('reset-error');
    errEl.classList.remove('show');

    const password = document.getElementById('reset-password').value;
    const confirm = document.getElementById('reset-confirm-password').value;

    if (!password || !confirm) {
        errEl.textContent = 'Both password fields are required.';
        errEl.classList.add('show');
        return;
    }
    if (password.length < 8) {
        errEl.textContent = 'Password must be at least 8 characters.';
        errEl.classList.add('show');
        return;
    }
    if (password !== confirm) {
        errEl.textContent = 'Passwords do not match.';
        errEl.classList.add('show');
        return;
    }

    const btn = document.getElementById('reset-submit-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Resetting...';

    try {
        const res = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: resetToken, newPassword: password })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showSuccessView();
        } else if (res.status === 400 && /invalid|expired/i.test(data.error || '')) {
            showInvalidView();
        } else {
            errEl.textContent = data.error || 'Failed to reset password.';
            errEl.classList.add('show');
        }
    } catch (err) {
        errEl.textContent = 'Connection error. Please try again.';
        errEl.classList.add('show');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Reset Password';
});
