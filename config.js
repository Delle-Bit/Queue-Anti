const STAFF_ROLES = ['admin', 'admintechnical', 'owner', 'frontdesk', 'laboratory', 'doctor'];
const ADMIN_ROLES = ['admin', 'admintechnical', 'owner'];
// Financial data - the sales report and its Excel export - is deliberately
// narrower than ADMIN_ROLES: only the business roles, not admin technical.
const SALES_ROLES = ['owner', 'admin'];

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

// Gate for the sales report and its export. Owner and admin only.
function requireSalesReport(req, res, next) {
    if (!SALES_ROLES.includes(req.user.role)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    next();
}

module.exports = { STAFF_ROLES, ADMIN_ROLES, SALES_ROLES, JWT_SECRET, requireStaff, requireAdmin, requireSalesReport };
