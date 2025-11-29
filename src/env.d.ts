/// <reference types="astro/client" />

interface Env {
  DB: D1Database;
  ADMIN_TOKEN: string;
  ADMIN_EMAIL: string;
  REPLY_TO_EMAIL: string;
}

declare namespace App {
  interface Locals {
    runtime: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}
