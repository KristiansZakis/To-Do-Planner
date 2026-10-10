document.getElementById('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('error');
    errorEl.textContent = '';
    const data = Object.fromEntries(new FormData(e.target));

    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const body = await res.json();

    if (res.ok) {
        window.location.href = '/dashboard';
    } else {
        errorEl.textContent = body.error || 'Something went wrong.';
    }
});