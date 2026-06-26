alter table payment_receipts
  add column if not exists verification_reason text;

alter table payment_receipts
  drop constraint if exists payment_receipts_verification_state_check;

alter table payment_receipts
  add constraint payment_receipts_verification_state_check
  check (verification_state in (
    'signature_verified',
    'pending_chain_verification',
    'chain_rejected'
  ));

alter table commission_accruals
  drop constraint if exists commission_accruals_status_check;

alter table commission_accruals
  add constraint commission_accruals_status_check
  check (status in (
    'pending_chain_verification',
    'available',
    'held',
    'allocated',
    'paid',
    'rejected',
    'reversed'
  ));
