-- The Vault is now called CHRIS. This changes the wording stored in the database: workflow playbook
-- text, the notes on steps already created from those playbooks, and the plan descriptions.
-- Wording only. No keys, ids or structure change, and the function name vault_search stays as it is.

update public.workflow_templates
   set steps = replace(replace(steps::text, 'the Vault', 'CHRIS'), 'Vault', 'CHRIS')::jsonb
 where steps::text like '%Vault%';

update public.workflow_instance_steps
   set notes = replace(replace(notes, 'the Vault', 'CHRIS'), 'Vault', 'CHRIS')
 where notes like '%Vault%';

update public.plan_features
   set notes = replace(replace(notes, 'the Vault', 'CHRIS'), 'Vault', 'CHRIS')
 where notes like '%Vault%';
