port module Main exposing (main)


port log : String -> Cmd msg


port eval : String -> Cmd msg


main : Program () () ()
main =
    Platform.worker
        { init =
            \_ ->
                ( ()
                , Cmd.batch
                    [ log "Hello from Main"
                    , eval "console.log('eval can reach ' + typeof app.ports.log.subscribe)"
                    ]
                )
        , update = \_ model -> ( model, Cmd.none )
        , subscriptions = \_ -> Sub.none
        }
