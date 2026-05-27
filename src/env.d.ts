/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    role: 'admin' | 'editor' | 'viewer';
  }
}
