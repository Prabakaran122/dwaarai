-- CommunityGate Demo Seed Data v2 (correct schema)

-- Add more units
INSERT INTO units (id, community_id, unit_number, floor, owner_name, status) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '101', 1, 'Raj Kumar', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '102', 1, 'Anita Desai', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '201', 2, 'Vikram Singh', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '202', 2, 'Meera Patel', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '401', 4, 'Arjun Mehta', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '402', 4, 'Divya Sharma', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '501', 5, 'Karthik Iyer', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '502', 5, 'Priya Gupta', 'occupied'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '103', 1, '', 'vacant'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '203', 2, '', 'vacant')
ON CONFLICT (community_id, unit_number) DO NOTHING;

-- Add residents for new units
INSERT INTO residents (id, community_id, unit_id, name, mobile, type, is_active)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000001', u.id, u.owner_name,
  '98' || lpad((floor(random() * 100000000)::bigint)::text, 8, '0'), 'resident', true
FROM units u
WHERE u.community_id = '00000000-0000-0000-0000-000000000001'
  AND u.owner_name != '' AND u.owner_name IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM residents r WHERE r.unit_id = u.id AND r.type = 'resident');

-- Add vehicles
INSERT INTO vehicles (id, community_id, unit_id, plate, make, model, type, is_active)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000001', u.id,
  'KA ' || lpad((floor(random() * 50 + 1)::int)::text, 2, '0') || ' '
  || chr(65 + floor(random()*26)::int) || chr(65 + floor(random()*26)::int) || ' '
  || lpad((floor(random() * 9000 + 1000)::int)::text, 4, '0'),
  (ARRAY['Honda','Toyota','Hyundai','Maruti','Tata','Mahindra','Kia'])[floor(random()*7+1)::int],
  (ARRAY['City','Innova','Creta','Swift','Nexon','XUV700','Seltos','i20','Fortuner','Baleno'])[floor(random()*10+1)::int],
  (ARRAY['car','car','car','suv','suv'])[floor(random()*5+1)::int],
  true
FROM units u
WHERE u.community_id = '00000000-0000-0000-0000-000000000001'
  AND u.status = 'occupied'
  AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.unit_id = u.id);

-- Add some second vehicles (bikes)
INSERT INTO vehicles (id, community_id, unit_id, plate, make, model, type, is_active)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000001', u.id,
  'KA ' || lpad((floor(random() * 50 + 1)::int)::text, 2, '0') || ' '
  || chr(65 + floor(random()*26)::int) || chr(65 + floor(random()*26)::int) || ' '
  || lpad((floor(random() * 9000 + 1000)::int)::text, 4, '0'),
  'Honda', 'Activa', 'bike', true
FROM units u
WHERE u.community_id = '00000000-0000-0000-0000-000000000001'
  AND u.status = 'occupied' AND random() < 0.35;

-- Add visitor passes (using first resident as created_by)
INSERT INTO visitor_passes (id, community_id, unit_id, created_by, visitor_name, visitor_mobile, otp, status, valid_from, valid_until)
SELECT
  gen_random_uuid(), '00000000-0000-0000-0000-000000000001', u.id, r.id,
  names.n, '99' || lpad((floor(random() * 100000000)::bigint)::text, 8, '0'),
  lpad((floor(random() * 900000 + 100000)::int)::text, 6, '0'),
  statuses.s,
  NOW() - interval '1 day' * floor(random() * 2),
  NOW() + interval '1 day' * floor(random() * 2 + 1)
FROM units u
JOIN residents r ON r.unit_id = u.id AND r.type = 'resident'
CROSS JOIN (VALUES ('Rahul Verma'), ('Sneha Kapoor'), ('Amit Joshi'), ('Pooja Rao'), ('Nikhil Das'), ('Sanya Malik'), ('Deepak Nair'), ('Kavita Bose')) AS names(n)
CROSS JOIN (VALUES ('active'), ('used'), ('expired')) AS statuses(s)
WHERE u.community_id = '00000000-0000-0000-0000-000000000001'
  AND random() < 0.05
LIMIT 8;

-- Add allowed gate events (last 48 hours)
INSERT INTO gate_events (id, community_id, gate_id, detection_method, raw_value, matched_vehicle_id, matched_unit_id, matched_unit_number, resident_name, access_decision, anpr_confidence, event_ts)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  (ARRAY['00000000-0000-0000-0000-000000100001','00000000-0000-0000-0000-000000100002'])[floor(random()*2+1)::int]::uuid,
  (ARRAY['anpr','anpr','anpr','rfid','rfid'])[floor(random()*5+1)::int],
  v.plate, v.id, v.unit_id, u.unit_number, r.name,
  'allow',
  CASE WHEN random() > 0.2 THEN 0.75 + random() * 0.25 ELSE NULL END,
  NOW() - interval '1 minute' * floor(random() * 2880)
FROM vehicles v
JOIN units u ON v.unit_id = u.id
JOIN residents r ON r.unit_id = u.id AND r.type = 'resident'
WHERE v.community_id = '00000000-0000-0000-0000-000000000001'
ORDER BY random()
LIMIT 50;

-- Add denied events
INSERT INTO gate_events (id, community_id, gate_id, detection_method, raw_value, access_decision, deny_reason, anpr_confidence, event_ts)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000100001',
  'anpr',
  'KA ' || lpad((floor(random() * 99)::int + 1)::text, 2, '0') || ' XX ' || lpad((floor(random() * 9000 + 1000)::int)::text, 4, '0'),
  'deny', 'unknown_vehicle',
  0.65 + random() * 0.3,
  NOW() - interval '1 minute' * floor(random() * 2880)
FROM generate_series(1, 12);

-- Add guard_review events
INSERT INTO gate_events (id, community_id, gate_id, detection_method, raw_value, access_decision, deny_reason, anpr_confidence, event_ts)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000100003',
  'anpr',
  'KA ' || lpad((floor(random() * 99)::int + 1)::text, 2, '0') || ' ?? ' || lpad((floor(random() * 9000 + 1000)::int)::text, 4, '0'),
  'guard_review', 'low_confidence',
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
