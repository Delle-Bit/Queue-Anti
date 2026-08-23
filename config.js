const STAFF_ROLES = ['admin', 'admintechnical', 'owner', 'frontdesk', 'laboratory', 'doctor'];
const ADMIN_ROLES = ['admin', 'admintechnical', 'owner'];

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function requireStaff(req, res, next) {
    if (!STAFF_ROLES.includes(req.user.role)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!ADMIN_ROLES.includes(req.user.role)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    next();
}

module.exports = { STAFF_ROLES, ADMIN_ROLES, JWT_SECRET, requireStaff, requireAdmin };
