port module Tools.Echo exposing (main)


port input : (String -> msg) -> Sub msg


port output : String -> Cmd msg


main : Program () () String
main =
    Platform.worker
        { init = \_ -> ( (), Cmd.none )
        , update = \text model -> ( model, output text )
        , subscriptions = \_ -> input identity
        }
