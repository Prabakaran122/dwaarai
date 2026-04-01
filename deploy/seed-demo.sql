-- CommunityGate Demo Seed Data
-- Adds realistic data: 3 gates, 18 units, 15 residents, 20+ vehicles, 8 passes, 75+ events

-- Add more gates
INSERT INTO gates (id, community_id, name, type, hardware, is_active, status) VALUES
  ('00000000-0000-0000-0000-000000100002', '00000000-0000-0000-0000-000000000001', 'Exit Gate', 'exit', '{"anpr": true, "rfid": true}', true, 'online'),
  ('00000000-0000-0000-0000-000000100003', '00000000-0000-0000-0000-000000000001', 'Visitor Gate', 'entry', '{"anpr": true, "rfid": false}', true, 'degraded')
ON CONFLICT DO NOTHING;

-- Add more units (blocks A, B, C)
INSERT INTO units (id, community_id, unit_number, block, floor, owner_name, status) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '101', 'A', 1, 'Raj Kumar', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '102', 'A', 1, 'Anita Desai', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '201', 'A', 2, 'Vikram Singh', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '202', 'A', 2, 'Meera Patel', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '301', 'B', 3, 'Suresh Reddy', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '302', 'B', 3, 'Lakshmi Nair', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '401', 'B', 4, 'Arjun Mehta', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '402', 'B', 4, 'Divya Sharma', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '501', 'C', 5, 'Karthik Iyer', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '502', 'C', 5, 'Priya Gupta', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '103', 'A', 1, '', 'vacant'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '203', 'A', 2, '', 'vacant'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '503', 'C', 5, '', 'vacant')
ON CONFLICT DO NOTHING;

-- Add residents for new units
INSERT INTO residents (id, community_id, unit_id, name, mobile, type, is_active)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000001', u.id, u.owner_name,
  '98' || lpad((floor(random() * 100000000)::bigint)::text, 8, '0'), 'resident', true
FROM units u
WHERE u.community_id = '00000000-0000-0000-0000-000000000001'
  AND u.owner_name != '' AND u.owner_name IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM residents r WHERE r.unit_id = u.id AND r.type = 'resident')
LIMIT 10;

-- Add vehicles for all occupied units that don't have one
INSERT INTO vehicles (id, community_id, unit_id, plate, make, model, type, is_active)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000001', u.id,
  'KA ' || lpad((floor(random() * 99)::int + 1)::text, 2, '0') || ' '
  || chr(65 + floor(random()*26)::int) || chr(65 + floor(random()*26)::int) || ' '
  || lpad((floor(random() * 9000 + 1000)::int)::text, 4, '0'),
  (ARRAY['Honda','Toyota','Hyundai','Maruti','Tata','Mahindra','Kia'])[floor(random()*7+1)::int],
  (ARRAY['City','Innova','Creta','Swift','Nexon','XUV700','Seltos','i20','Fortuner','Baleno'])[floor(random()*10+1)::int],
  (ARRAY['car','car','car','suv','suv'])[floor(random()*5+1)::int],
  true
FROM units u
WHERE u.community_id = '00000000-0000-0000-0000-000000000001'
  AND u.status = 'occupied'
  AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.unit_id = u.id)
LIMIT 15;

-- Add second vehicles (bikes) for some units
INSERT INTO vehicles (id, community_id, unit_id, plate, make, model, type, is_active)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000001', u.id,
  'KA ' || lpad((floor(random() * 99)::int + 1)::text, 2, '0') || ' '
  || chr(65 + floor(random()*26)::int) || chr(65 + floor(random()*26)::int) || ' '
  || lpad((floor(random() * 9000 + 1000)::int)::text, 4, '0'),
  'Honda', 'Activa', 'bike', true
FROM units u
WHERE u.community_id = '00000000-0000-0000-0000-000000000001'
  AND u.status = 'occupied' AND random() < 0.4
LIMIT 5;

-- Add visitor passes
INSERT INTO visitor_passes (id, community_id, unit_id, visitor_name, visitor_phone, otp, status, valid_from, valid_until) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', (SELECT id FROM units WHERE unit_number='101' AND community_id='00000000-0000-0000-0000-000000000001' LIMIT 1), 'Rahul Verma', '9912345678', '482951', 'active', NOW(), NOW() + interval '24 hours'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', (SELECT id FROM units WHERE unit_number='201' AND community_id='00000000-0000-0000-0000-000000000001' LIMIT 1), 'Sneha Kapoor', '9923456789', '731628', 'active', NOW(), NOW() + interval '12 hours'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', (SELECT id FROM units WHERE unit_number='301' AND community_id='00000000-0000-0000-0000-000000000001' LIMIT 1), 'Amit Joshi', '9934567890', '159374', 'active', NOW() - interval '2 hours', NOW() + interval '6 hours'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', (SELECT id FROM units WHERE unit_number='102' AND community_id='00000000-0000-0000-0000-000000000001' LIMIT 1), 'Pooja Rao', '9945678901', '628415', 'used', NOW() - interval '1 day', NOW() - interval '2 hours'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', (SELECT id FROM units WHERE unit_number='202' AND community_id='00000000-0000-0000-0000-000000000001' LIMIT 1), 'Nikhil Das', '9956789012', '947362', 'expired', NOW() - interval '3 days', NOW() - interval '2 days'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', (SELECT id FROM units WHERE unit_number='401' AND community_id='00000000-0000-0000-0000-000000000001' LIMIT 1), 'Sanya Malik', '9967890123', '283641', 'active', NOW(), NOW() + interval '48 hours'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', (SELECT id FROM units WHERE unit_number='501' AND community_id='00000000-0000-0000-0000-000000000001' LIMIT 1), 'Deepak Nair', '9978901234', '516293', 'used', NOW() - interval '5 hours', NOW() + interval '19 hours'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', (SELECT id FROM units WHERE unit_number='302' AND community_id='00000000-0000-0000-0000-000000000001' LIMIT 1), 'Kavita Bose', '9989012345', '374185', 'active', NOW() - interval '1 hour', NOW() + interval '23 hours')
ON CONFLICT DO NOTHING;

-- Add gate events: allowed entries (last 48 hours)
INSERT INTO gate_events (id, community_id, gate_id, detection_method, raw_value, matched_vehicle_id, matched_unit_id, matched_unit_number, resident_name, access_decision, anpr_confidence, event_ts)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  (ARRAY['00000000-0000-0000-0000-000000100001','00000000-0000-0000-0000-000000100002'])[floor(random()*2+1)::int]::uuid,
  (ARRAY['anpr','anpr','anpr','rfid','rfid'])[floor(random()*5+1)::int],
  v.plate,
  v.id,
  v.unit_id,
  u.unit_number,
  r.name,
  'allow',
  CASE WHEN random() > 0.2 THEN 0.75 + random() * 0.25 ELSE NULL END,
  NOW() - interval '1 minute' * floor(random() * 2880)
FROM vehicles v
JOIN units u ON v.unit_id = u.id
JOIN residents r ON r.unit_id = u.id AND r.type = 'resident'
WHERE v.community_id = '00000000-0000-0000-0000-000000000001'
CROSS JOIN generate_series(1, 3)
LIMIT 45;

-- Add denied events (unknown vehicles)
INSERT INTO gate_events (id, community_id, gate_id, detection_method, raw_value, access_decision, deny_reason, anpr_confidence, event_ts)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000100001',
  'anpr',
  'KA ' || lpad((floor(random() * 99)::int + 1)::text, 2, '0') || ' XX ' || lpad((floor(random() * 9000 + 1000)::int)::text, 4, '0'),
  'deny',
  'unknown_vehicle',
  0.65 + random() * 0.3,
  NOW() - interval '1 minute' * floor(random() * 2880)
FROM generate_series(1, 12);

-- Add guard_review events (low confidence)
INSERT INTO gate_events (id, community_id, gate_id, detection_method, raw_value, access_decision, deny_reason, anpr_confidence, event_ts)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000100003',
  'anpr',
  'KA ' || lpad((floor(random() * 99)::int + 1)::text, 2, '0') || ' ?? ' || lpad((floor(random() * 9000 + 1000)::int)::text, 4, '0'),
  'guard_review',
  'low_confidence',
  0.3 + random() * 0.25,
  NOW() - interval '1 minute' * floor(random() * 1440)
FROM generate_series(1, 8);

-- Final counts
SELECT 'gates' as tbl, count(*) FROM gates
UNION ALL SELECT 'units', count(*) FROM units
UNION ALL SELECT 'residents', count(*) FROM residents
UNION ALL SELECT 'vehicles', count(*) FROM vehicles
UNION ALL SELECT 'visitor_passes', count(*) FROM visitor_passes
UNION ALL SELECT 'gate_events', count(*) FROM gate_events
ORDER BY tbl;
