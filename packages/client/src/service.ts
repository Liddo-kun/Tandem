// UPSTREAM-DIVERGENCE: document the Tandem local service without renaming wire fields.
/** Connection details for a local Tandem service. */
export type Endpoint = {
  /** Base URL of the service. */
  readonly url: string
  /** Authentication required by the service, when configured. */
  readonly auth?: {
    /** HTTP authentication scheme. */
    readonly type: "basic"
    /** Basic authentication username. */
    readonly username: string
    /** Basic authentication password. */
    readonly password: string
  }
}

// UPSTREAM-DIVERGENCE: identify Tandem's service discovery options.
/** Options used to discover the local Tandem service. */
export type DiscoverOptions = {
  /** Absolute registration file path. Defaults to the XDG state directory. */
  readonly file?: string
  /** Required exact service version or compatibility predicate. */
  readonly version?: string | ((version: string) => boolean)
}

/** Reason ensuring the service requires a new process. */
export type EnsureReason = "missing" | "version-mismatch"

// UPSTREAM-DIVERGENCE: document Tandem's managed-service command default.
/** Options used to ensure the local Tandem service is running. */
export type EnsureOptions = DiscoverOptions & {
  /** Service command and arguments. Defaults to `tandem serve --service`. */
  readonly command?: ReadonlyArray<string>
  /** Environment variables added to the inherited service process environment. */
  readonly env?: Readonly<Record<string, string>>
  /** Called once before spawning a new service process. */
  readonly onStart?: (reason: EnsureReason, previousVersion?: string) => void
}

// UPSTREAM-DIVERGENCE: identify Tandem's local-service stop options.
/** Options used to stop the local Tandem service. */
export type StopOptions = {
  /** Absolute registration file path. Defaults to the XDG state directory. */
  readonly file?: string
  /** How to handle persistent terminals before stopping the service. */
  readonly pty?: "clear" | "handoff"
}

/** Contents of the local service registration file. */
export type Info = {
  /** Unique service instance identifier. */
  readonly id?: string
  // UPSTREAM-DIVERGENCE: describe the served application version without upstream product branding.
  /** Application version served by the process. */
  readonly version?: string
  /** Base URL advertised by the service. */
  readonly url: string
  /** Operating system process identifier. */
  readonly pid: number
  /** Private service password, when authentication is enabled. */
  readonly password?: string
}
