-- BUG-023: Create sequence for sequential case numbers in tenant databases
CREATE SEQUENCE IF NOT EXISTS case_number_seq;

-- Initialize sequence to highest existing sequential case number (so nextval starts at next sequential number)
DO $$
DECLARE
    max_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(
        CASE 
            WHEN "caseId" ~* '^Case-([0-9]+)$' THEN CAST(SUBSTRING("caseId" from 6) AS INTEGER)
            ELSE 0 
        END
    ), 0) INTO max_num FROM cases;
    
    IF max_num > 0 THEN
        PERFORM setval('case_number_seq', max_num);
    END IF;
END $$;
