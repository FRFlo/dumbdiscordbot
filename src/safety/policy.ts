import type { ToolRisk } from "../domain/types";

export class SafetyPolicy {
  public canExecute(risk: ToolRisk): boolean {
    // Les confirmations interactives seront ajoutées avant les tools sensibles.
    return risk === "low";
  }
}
