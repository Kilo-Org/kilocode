SELECT
    c.name,
    SUM(o.total) AS total_spent
FROM orders o

WHERE o.created_at >= '2026-01-01'
GROUP BY c.name
ORDER BY total_spent DESC
LIMIT 10;
