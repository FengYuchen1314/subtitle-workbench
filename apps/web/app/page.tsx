"use client";
import { Workbench, HttpGateway } from "@subtitle/ui";
const gateway = new HttpGateway();
export default function Page() {
  return <Workbench gateway={gateway} />;
}
