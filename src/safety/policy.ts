export class SafetyPolicy {
  public canExecute(risk: "low" | "medium" | "high"): boolean {
    // Les confirmations interactives seront ajoutées avant les tools sensibles.
    return risk === "low";
  }
}
