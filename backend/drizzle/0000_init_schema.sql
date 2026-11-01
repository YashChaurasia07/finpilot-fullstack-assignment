CREATE TYPE "public"."account_status" AS ENUM('ACTIVE', 'DORMANT', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('BROKERAGE', 'MUTUAL_FUND', 'RETIREMENT');--> statement-breakpoint
CREATE TYPE "public"."asset_class" AS ENUM('EQUITY', 'ETF', 'MUTUAL_FUND', 'BOND', 'REIT', 'GSEC');--> statement-breakpoint
CREATE TYPE "public"."exchange" AS ENUM('NSE', 'BSE', 'OTC');--> statement-breakpoint
CREATE TYPE "public"."goal_type" AS ENUM('RETIREMENT', 'EDUCATION', 'HOME_PURCHASE', 'EMERGENCY_FUND', 'TRAVEL', 'WEALTH_CREATION');--> statement-breakpoint
CREATE TYPE "public"."import_dataset" AS ENUM('transactions', 'holdings');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('VERIFIED', 'PENDING', 'REVIEW');--> statement-breakpoint
CREATE TYPE "public"."liquidity_need" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."risk_band" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('Conservative', 'Moderate', 'Growth', 'Aggressive');--> statement-breakpoint
CREATE TYPE "public"."segment" AS ENUM('Mass', 'Affluent', 'HNI');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('SETTLED', 'PENDING', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('BUY', 'SELL', 'DIVIDEND', 'FEE');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('VIEWER', 'ADMIN');--> statement-breakpoint
CREATE SEQUENCE "public"."goal_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "accounts" (
	"account_id" varchar(12) PRIMARY KEY NOT NULL,
	"customer_id" varchar(12) NOT NULL,
	"account_type" "account_type" NOT NULL,
	"provider" varchar(80) NOT NULL,
	"opened_at" date NOT NULL,
	"status" "account_status" NOT NULL,
	"base_currency" char(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"customer_id" varchar(12) PRIMARY KEY NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"email" varchar(254) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"city" varchar(80) NOT NULL,
	"state" char(2) NOT NULL,
	"date_of_birth" date NOT NULL,
	"onboarded_at" date NOT NULL,
	"kyc_status" "kyc_status" NOT NULL,
	"segment" "segment" NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"goal_id" varchar(12) PRIMARY KEY DEFAULT 'G' || lpad(nextval('goal_id_seq')::text, 5, '0') NOT NULL,
	"customer_id" varchar(12) NOT NULL,
	"goal_type" "goal_type" NOT NULL,
	"goal_name" varchar(120) NOT NULL,
	"target_amount" numeric(18, 2) NOT NULL,
	"current_funded_amount" numeric(18, 2) NOT NULL,
	"target_date" date NOT NULL,
	"priority" "priority" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_target_positive" CHECK ("goals"."target_amount" > 0),
	CONSTRAINT "goals_funded_non_negative" CHECK ("goals"."current_funded_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"account_id" varchar(12) NOT NULL,
	"instrument_id" varchar(12) NOT NULL,
	"snapshot_date" date NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"avg_cost" numeric(18, 2) NOT NULL,
	CONSTRAINT "holdings_account_id_instrument_id_snapshot_date_pk" PRIMARY KEY("account_id","instrument_id","snapshot_date"),
	CONSTRAINT "holdings_quantity_positive" CHECK ("holdings"."quantity" > 0),
	CONSTRAINT "holdings_avg_cost_non_negative" CHECK ("holdings"."avg_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dataset" "import_dataset" NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_sha256" char(64) NOT NULL,
	"total_rows" integer NOT NULL,
	"imported_rows" integer NOT NULL,
	"rejected_rows" integer NOT NULL,
	"imported_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_counts" CHECK ("import_batches"."imported_rows" + "import_batches"."rejected_rows" = "import_batches"."total_rows")
);
--> statement-breakpoint
CREATE TABLE "import_rejections" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_rejections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"batch_id" integer NOT NULL,
	"row_number" integer NOT NULL,
	"record_key" varchar(80),
	"code" varchar(40) NOT NULL,
	"detail" text NOT NULL,
	"raw_row" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"instrument_id" varchar(12) PRIMARY KEY NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"instrument_name" varchar(120) NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"sector" varchar(60),
	"exchange" "exchange" NOT NULL,
	"currency" char(3) NOT NULL,
	"last_price" numeric(18, 2) NOT NULL,
	"price_as_of" date NOT NULL,
	"risk_band" "risk_band" NOT NULL,
	CONSTRAINT "instruments_symbol_unique" UNIQUE("symbol"),
	CONSTRAINT "instruments_price_positive" CHECK ("instruments"."last_price" > 0)
);
--> statement-breakpoint
CREATE TABLE "risk_profiles" (
	"customer_id" varchar(12) PRIMARY KEY NOT NULL,
	"risk_score" smallint NOT NULL,
	"risk_level" "risk_level" NOT NULL,
	"assessed_at" date NOT NULL,
	"horizon_years" smallint NOT NULL,
	"liquidity_need" "liquidity_need" NOT NULL,
	CONSTRAINT "risk_profiles_score_range" CHECK ("risk_profiles"."risk_score" between 0 and 100),
	CONSTRAINT "risk_profiles_horizon_positive" CHECK ("risk_profiles"."horizon_years" > 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"transaction_id" varchar(12) PRIMARY KEY NOT NULL,
	"account_id" varchar(12) NOT NULL,
	"instrument_id" varchar(12) NOT NULL,
	"transaction_type" "transaction_type" NOT NULL,
	"trade_date" date NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"status" "transaction_status" NOT NULL,
	"import_batch_id" integer,
	CONSTRAINT "transactions_quantity_non_negative" CHECK ("transactions"."quantity" >= 0),
	CONSTRAINT "transactions_price_non_negative" CHECK ("transactions"."price" >= 0),
	CONSTRAINT "transactions_amount_non_negative" CHECK ("transactions"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email" varchar(254) NOT NULL,
	"password_hash" varchar(100) NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"role" "user_role" DEFAULT 'VIEWER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_customer_id_customers_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("customer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_customer_id_customers_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("customer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_account_id_accounts_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_instrument_id_instruments_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("instrument_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rejections" ADD CONSTRAINT "import_rejections_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_profiles" ADD CONSTRAINT "risk_profiles_customer_id_customers_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("customer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_instrument_id_instruments_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("instrument_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_customer_idx" ON "accounts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "goals_customer_idx" ON "goals" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "holdings_instrument_idx" ON "holdings" USING btree ("instrument_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_file_uq" ON "import_batches" USING btree ("dataset","file_sha256") WHERE "import_batches"."imported_rows" > 0;--> statement-breakpoint
CREATE INDEX "import_rejections_batch_idx" ON "import_rejections" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "transactions_account_date_idx" ON "transactions" USING btree ("account_id","trade_date" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "transactions_instrument_idx" ON "transactions" USING btree ("instrument_id");