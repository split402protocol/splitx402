create table if not exists payout_transaction_items (
  payout_transaction_id text not null references payout_transactions(id),
  payout_item_id text not null references payout_items(id),
  amount_atomic text not null check (amount_atomic ~ '^[1-9][0-9]*$'),
  destination_wallet text not null,
  destination_token_account text,
  primary key (payout_transaction_id, payout_item_id)
);

create index if not exists payout_transaction_items_item_idx
  on payout_transaction_items(payout_item_id);
